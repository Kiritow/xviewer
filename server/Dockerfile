FROM ubuntu:20.04
RUN apt update && apt install -y curl xz-utils && rm -rf /var/lib/apt/lists/*
# Install NodeJS 12 LTS
RUN cd /usr/local && curl -vSL https://nodejs.org/dist/v18.17.1/node-v18.17.1-linux-x64.tar.xz | tar --strip-components 1 -xJ

COPY package.json /app/
RUN cd /app && npm install
COPY . /app/
WORKDIR /app
CMD node app
EXPOSE 80
