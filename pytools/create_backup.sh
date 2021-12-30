#!/bin/bash

mysqldump -h$DB_HOST -P$DB_PORT -u$DB_USER -p$DB_PASS --column-statistics=0 --single-transaction $DB_NAME | gzip > "backup_$(date +"%Y%m%d_%I%M%S").sql"
