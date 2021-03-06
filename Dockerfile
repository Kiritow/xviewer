FROM ubuntu:20.04
RUN sed -i 's/archive.ubuntu.com/mirrors.cloud.tencent.com/g; s/security.ubuntu.com/mirrors.cloud.tencent.com/g' /etc/apt/sources.list \
    && rm -f /etc/apt/apt.conf.d/docker-gzip-indexes
RUN apt update && apt install -y curl xz-utils && rm -rf /var/lib/apt/lists/*
# Install NodeJS 12 LTS
RUN cd /usr/local && curl -vSL https://nodejs.org/dist/v12.18.4/node-v12.18.4-linux-x64.tar.xz | tar --strip-components 1 -xJ

COPY package.json /app/
RUN cd /app && npm install
COPY . /app/
WORKDIR /app
CMD node app
EXPOSE 80
