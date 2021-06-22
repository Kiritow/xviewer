FROM ubuntu:20.04
RUN sed -i 's/archive.ubuntu.com/mirrors.aliyun.com/g; s/security.ubuntu.com/mirrors.aliyun.com/g' /etc/apt/sources.list \
    && rm -f /etc/apt/apt.conf.d/docker-gzip-indexes

# Install NodeJS 12 LTS
RUN cd /usr/local && curl -vSL https://nodejs.org/dist/v12.18.4/node-v12.18.4-linux-x64.tar.xz | tar --strip-components 1 -xJ

COPY package.json /app/
RUN cd /app && npm install
COPY . /app/
WORKDIR /app
RUN node app
EXPOSE 80
