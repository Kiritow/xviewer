# -*- coding: utf-8 -*-
import os
import json
import traceback
from UniTools.UniCon import UniCon
from elasticsearch import Elasticsearch, helpers


if __name__ == "__main__":
    conn = UniCon.connect_mysql(os.getenv("DB_HOST"), int(os.getenv("DB_PORT")), os.getenv("DB_USER"), os.getenv("DB_PASS"), os.getenv("DB_NAME"))
    result = conn.query("select * from objects A inner join videos B on A.id=B.id")

    es = Elasticsearch(["http://{}:9200".format(os.getenv("ES_HOST"))])
    print "Removing previous video index..."
    try:
        es.indices.delete(index=os.getenv("ES_INDEX"))
    except Exception:
        print traceback.format_exc()

    print "Creating video index..."
    try:
        es.indices.create(index=os.getenv("ES_INDEX"), ignore=400)
    except Exception:
        print traceback.format_exc()

    # 写入数据（批量）
    batch_data = [{
        "_index": os.getenv("ES_INDEX"),
        "_source": {
            "name": row['filename'],
            "vid": row['id']
        }
    } for row in result]

    print "Sending to ES..."
    helpers.bulk(es, batch_data)
