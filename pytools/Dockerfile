FROM ubuntu:20.04
RUN apt update && DEBIAN_FRONTEND=noninteractive TZ=Asia/Shanghai apt install -y gzip python3 python3-pip mysql-client libmysqlclient-dev ffmpeg && rm -rf /var/lib/apt/lists/*
RUN pip install elasticsearch pymysql
COPY . /root/
WORKDIR /root/
CMD sleep infinity
