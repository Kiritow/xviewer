# -*- coding: utf-8 -*-
import os
import hashlib
import subprocess
import uuid
import time
import json
from UniTools.UniCon import UniCon


def get_file_hash(filepath):
    with open(filepath) as f:
        content = f.read()
    sha = hashlib.sha256()
    sha.update(content)
    return sha.hexdigest()


def generate_cover(root_dir, video_path):
    cover_path = os.path.join(root_dir, "temp", "{}.png".format(uuid.uuid4()))
    print "Generating cover for {} to {}...".format(video_path, cover_path)
    subprocess.check_call(["ffmpeg", "-ss", "00:00:05.000", "-i", video_path, "-vframes", "1", cover_path, "-y"])
    return cover_path, get_file_hash(cover_path)


if __name__ == "__main__":
    with open("config.json") as f:
        config = json.loads(f.read())

    root_dir = config["root"]

    tasks = []
    for root, dirs, files in os.walk(os.path.join(root_dir, "objects")):
        for name in files:
            fullpath = os.path.join(root, name)
            if "." in name:
               tasks.append((fullpath, name))

        for name in dirs:
            print os.path.join(root, name)

    if not tasks:
        print "no task found, now exit."
        exit(0)

    print "{} tasks found".format(len(tasks))

    conn = UniCon.connect_mysql(config["host"], config["port"], config["username"], config["password"], config["database"])
    result = conn.query("select * from objects")
    idset = {row['id']: row['filename'] for row in result}
    for fullpath, filename in tasks:
        print "Computing hash of file: {}".format(fullpath)
        video_hash = get_file_hash(fullpath)
        if video_hash in idset:
            print "[Skipped] Video already exists: {}\n  Record name: {}\n  hash: {}".format(filename, idset[video_hash], video_hash)
            continue

        cover_path, cover_hash = generate_cover(root_dir, fullpath)
        if cover_hash in idset:
            print "[Ignored] Cover {} already exists."
            cover_new = False
        else:
            cover_new = True

        print "Reading video file info..."
        video_info = os.stat(fullpath)
        video_modify_time = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(video_info.st_mtime))
        video_size = video_info.st_size

        print "Reading cover file info..."
        cover_info = os.stat(cover_path)
        cover_modify_time = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(cover_info.st_mtime))
        cover_size = cover_info.st_size

        print "Creating video objects in db..."
        conn.execute("insert into objects(id,filename,mtime,fsize) values (%s, %s, %s, %s)", [video_hash, filename, video_modify_time, video_size])
        if cover_new:
            print "Creating cover objects in db...."
            cover_name = "{}.png".format(os.path.basename(filename))
            conn.execute("insert into objects(id,filename,mtime,fsize) values (%s, %s, %s, %s)", [cover_hash, cover_name, cover_modify_time, cover_size])

        conn.execute("insert into videos(id, coverid) values (%s, %s)", [video_hash, cover_hash])

        print "Renaming video object: {} -> {}".format(filename, video_hash)
        os.rename(fullpath, os.path.join(root_dir, "objects", video_hash))
        if cover_new:
            print "Moving cover object: {}".format(cover_hash)
            os.rename(cover_path, os.path.join(root_dir, "objects", cover_hash))

        print "Done. New video added: {}".format(filename)
        conn.commit()

        # This might be slow, but it is simple.
        print "Reloading idset..."
        result = conn.query("select * from objects")
        idset = {row['id']: row['filename'] for row in result}
