# -*- coding: utf-8 -*-

from UniTools.UniCon import UniCon
from multiprocessing import Process
import os
import hashlib
import subprocess
import uuid
import json


CONFIG_DIR = "/mnt/d/xviewer/config"

# --- Initialize with Config ---
with open(os.path.join(CONFIG_DIR, "settings.json")) as f:
    j = json.loads(f.read())
    ROOT_DIR = j["rootdir"]

with open(os.path.join(CONFIG_DIR, "mysql_config.json")) as f:
    j = json.loads(f.read())
    DB_HOST = j["host"]
    DB_USER = j["user"]
    DB_PASS = j["password"]
    DB_NAME = j["database"]
    DB_PORT = j.get("port", 3306)


def GetFileHash(filepath):
    with open(filepath) as f:
        content = f.read()
    sha = hashlib.sha256()
    sha.update(content)
    return sha.hexdigest()


def GenerateCover(video_path):
    cover_path = "../temp/{}.png".format(uuid.uuid4())
    print "Generating cover for {} to {}...".format(video_path, cover_path)
    subprocess.check_call(["ffmpeg", "-ss", "00:00:05.000", "-i", video_path, "-vframes", "1", cover_path, "-y"])
    return cover_path, GetFileHash(cover_path)


if __name__ == "__main__":
    os.chdir(ROOT_DIR)

    tasks = []
    for root, dirs, files in os.walk("./objects"):
        for name in files:
            fullpath = os.path.join(root, name)
            if "." in name:
               tasks.append((fullpath, name))

        for name in dirs:
            print os.path.join(root, name)

    conn = UniCon.connect_mysql(DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME)
    result = conn.query("select * from objects")
    idset = {row['id']: row['filename'] for row in result}
    for fullpath, filename in tasks:
        video_hash = GetFileHash(fullpath)
        if video_hash in idset:
            print "[Skipped] Video already exists: {}\n  Record name: {}\n  hash: {}".format(filename, idset[video_hash], video_hash)
            continue
        
        cover_path, cover_hash = GenerateCover(fullpath)
        if cover_hash in idset:
            print "[Ignored] Cover {} already exists."
            cover_new = False
        else:
            cover_new = True

        print "Reading video file info..."
        video_info = os.stat(fullpath)
        video_modify_time = int(video_info.st_mtime)
        video_size = video_info.st_size

        print "Reading cover file info..."
        cover_info = os.stat(cover_path)
        cover_modify_time = int(cover_info.st_mtime)
        cover_size = cover_info.st_size

        print "Creating video objects in db..."
        conn.execute("insert into objects(id,filename,mtime,fsize) values (%s, %s, %s, %s)", [video_hash, filename, video_modify_time, video_size])
        if cover_new:
            print "Creating cover objects in db...."
            cover_name = "{}.png".format(os.path.basename(filename))
            conn.execute("insert into objects(id,filename,mtime,fsize) values (%s, %s, %s, %s)", [cover_hash, cover_name, cover_modify_time, cover_size])

        conn.execute("insert into videos(id, coverid) values (%s, %s)", [video_hash, cover_hash])

        print "Renaming video object: {} -> {}".format(filename, video_hash)
        os.rename(fullpath, "./objects/{}".format(video_hash))
        if cover_new:
            print "Moving cover object: {}".format(cover_hash)
            os.rename(cover_path, "./objects/{}".format(cover_hash))
        
        print "Done. New video added: {}".format(filename)
        conn.commit()
        
        print "Reloading idset..."
        result = conn.query("select * from objects")
        idset = {row['id']: row['filename'] for row in result}
