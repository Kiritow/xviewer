# -*- coding: utf-8 -*-
import os
from UniTools.UniCon import UniCon


if __name__ == "__main__":
    video_id = input('Input video id to remove: ')
    conn = UniCon.connect_mysql(os.getenv("DB_HOST"), int(os.getenv("DB_PORT")), os.getenv("DB_USER"), os.getenv("DB_PASS"), os.getenv("DB_NAME"))
    result = conn.query('select * from objects where id=%s', [video_id])
    if not result:
        print('object not found: {}'.format(video_id))
        exit(1)
    object_info = result[0]
    print('Object found, name: {}'.format(object_info['filename']))
    result = conn.query('select * from videos where id=%s', [video_id])
    if not result:
        print('video not found: {}'.format(video_id))
        exit(1)
    print('Video found.')

    confirm = input('Confirm deletion? [y/N]')
    if not confirm or confirm != 'y':
        print('Aborted.')
        exit(1)

    confirm = input('Delete object from disk? [y/N]')
    if not confirm or confirm != 'y':
        print('Object {} not deleted.'.format(video_id))
    else:
        object_path = '/data/objects/{}/{}'.format(video_id[:2], video_id)
        file_path = os.path.join('/data/pending', '{}-{}'.format(object_info['id'], object_info['filename']))
        print('Restoring {} -> {}'.format(object_path, file_path))
        os.rename(object_path, file_path)

    print('Deleting from database...')
    conn.execute('delete from videos where id=%s', [video_id])
    conn.execute('delete from objects where id=%s', [video_id])

    print('Committing...')
    conn.commit()
