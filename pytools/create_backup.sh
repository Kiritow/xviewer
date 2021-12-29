#!/bin/bash

mysqldump -h$DB_HOST -P$DB_PORT -u$DB_USER $p$DB_PASS --single-transaction $DB_NAME > "backup_$(date +"%Y%m%d_%I%M%S").sql"
