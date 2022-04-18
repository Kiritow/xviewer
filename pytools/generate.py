# -*- coding: utf-8 -*-
# Directory tree:
# project
#     - code/
#         - UniTools/
#         - generate.py (this script, must run it from here)
#         - config.json (database configuration)
#     - temp/
#     - objects/

import os
import sys
import hashlib
import subprocess
import uuid
import time
import json
import traceback
from UniTools.UniCon import UniCon
from UniTools.UniClock import TimeFormat


TEMP_PATH = '/data/temp'
OBJECT_PATH = '/data/objects'
PENDING_PATH = '/data/pending'


def write_progress(content):
    sys.stdout.write("\033[2K\r{}".format(content))
    time.sleep(0.1)


def write_finish(content):
    sys.stdout.write("\033[2K\r{}\n".format(content))


def readable_bytes(size):
    if size < 1024:
        return "{}B".format(size)
    if size < 1024 * 1024:
        return "{}KB".format(round(size / 1024, 2))
    if size < 1024 * 1024 * 1024:
        return "{}MB".format(round(size / 1024 / 1024, 2))
    return "{}GB".format(round(size / 1024 / 1024 / 1024, 2))


def get_file_hash(filepath):
    bytes_read = 0
    bytes_total = os.stat(filepath).st_size
    read_size = 32 * 1024 * 1024
    time_start = time.time()

    sha = hashlib.sha256()
    with open(filepath, 'rb') as f:
        while True:
            content = f.read(read_size)
            if not content:
                break
            bytes_read += len(content)
            sha.update(content)

            read_speed = bytes_read / (time.time() - time_start)
            read_eta = (bytes_total - bytes_read) / read_speed
            write_progress('Reading file... {} of {} ({}%) Speed: {}/s TimeSpent: {} ETA: {}'.format(
                readable_bytes(bytes_read),
                readable_bytes(bytes_total),
                round(bytes_read / bytes_total * 100, 2),
                readable_bytes(read_speed),
                TimeFormat(time.time() - time_start),
                TimeFormat(read_eta)
            ))
    write_finish('Computed file size: {} in {}'.format(readable_bytes(bytes_read), TimeFormat(time.time() - time_start)))
    return sha.hexdigest()


def generate_cover(video_path):
    cover_path = os.path.join(TEMP_PATH, "{}.png".format(uuid.uuid4()))
    print("Generating cover for {} to {}...".format(video_path, cover_path))
    subprocess.check_call(["ffmpeg", "-ss", "00:00:05.000", "-i", video_path, "-vframes", "1", cover_path, "-y"])
    return cover_path, get_file_hash(cover_path)


def add_video(fullpath, filename, tags=None):
    conn = UniCon.connect_mysql(os.getenv("DB_HOST"), int(os.getenv("DB_PORT")), os.getenv("DB_USER"), os.getenv("DB_PASS"), os.getenv("DB_NAME"))
    result = conn.query("select * from objects")
    idset = {row['id']: row['filename'] for row in result}

    print("Computing hash of file: {}".format(fullpath))
    video_hash = get_file_hash(fullpath)
    if video_hash in idset:
        print("[Skipped] Video already exists: {}\n  Record name: {}\n  hash: {}".format(filename, idset[video_hash], video_hash))
        return False
    
    cover_path, cover_hash = generate_cover(fullpath)
    if cover_hash in idset:
        print("[Ignored] Cover {} already exists. Previous name is: {}".format(cover_hash, idset[cover_hash]))
        cover_new = False
    else:
        cover_new = True

    print("Reading video file info...")
    video_info = os.stat(fullpath)
    video_modify_time = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(video_info.st_mtime))
    video_size = video_info.st_size

    print("Reading cover file info...")
    cover_info = os.stat(cover_path)
    cover_modify_time = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(cover_info.st_mtime))
    cover_size = cover_info.st_size

    print("Creating video objects in db...")
    conn.execute("insert into objects(id,filename,mtime,fsize) values (%s, %s, %s, %s)", [video_hash, filename, video_modify_time, video_size])
    if cover_new:
        print("Creating cover objects in db....")
        cover_name = "{}.png".format(os.path.basename(filename))
        conn.execute("insert into objects(id,filename,mtime,fsize) values (%s, %s, %s, %s)", [cover_hash, cover_name, cover_modify_time, cover_size])

    print("Gathering information about video...")
    video_duration = 0
    try:
        content = subprocess.check_output(["ffprobe", "-i", fullpath, "-show_format"])
        content = content.decode()
        for line in content.split('\n'):
            if line.startswith("duration="):
                video_duration = int(float(line.replace("duration=", "")))
    except Exception:
        print(traceback.format_exc())

    conn.execute("insert into videos(id, coverid, videotime, tags) values (%s, %s, %s, %s)", [video_hash, cover_hash, video_duration, json.dumps(tags or [], ensure_ascii=False)])

    print("Renaming video object: {} -> {}".format(filename, video_hash))
    video_hash_prefix = video_hash[0:2]
    subprocess.check_call(["mv", fullpath, os.path.join(OBJECT_PATH, video_hash_prefix, video_hash)])
    if cover_new:
        print("Moving cover object: {}".format(cover_hash))
        cover_hash_prefix = cover_hash[0:2]
        subprocess.check_call(["mv", cover_path, os.path.join(OBJECT_PATH, cover_hash_prefix, cover_hash)])

    print("Done. New video added: {}".format(filename))
    conn.commit()

    return True


if __name__ == "__main__":
    print(sys.argv)
    if len(sys.argv) < 2:
        root_path = PENDING_PATH
        enable_tag = False
        print("root path default to {}".format(root_path))
    else:
        root_path = sys.argv[1]
        enable_tag = True

    path_base = os.path.basename(root_path)
    print("path base is {}".format(path_base))

    tasks = []
    for root, dirs, files in os.walk(root_path):
        for name in files:
            fullpath = os.path.join(root, name)
            if name.lower().endswith(".mp4"):
                print("file: root: {} dirname: {} name: {}".format(root, os.path.basename(root), name))
                if enable_tag:
                    segs = [n for n in root.split('/') if n]
                    while segs[0] != path_base:
                        segs.pop(0)
                    while len(segs) > 2:
                        segs.pop()
                    tasks.append((fullpath, name, [segs[1]] if len(segs) > 1 else []))
                else:
                    tasks.append((fullpath, name, []))

        for name in dirs:
            print("dir: {}".format(os.path.join(root, name)))

    if not tasks:
        print("no task found, now exit.")
        exit(0)

    print(json.dumps(tasks, ensure_ascii=False, indent=2))

    print("{} tasks found".format(len(tasks)))

    for fullpath, filename, tags in tasks:
        add_video(fullpath, filename, tags)
