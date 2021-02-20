FROM ubuntu:20.04

# Install NodeJS 12 LTS
RUN cd /usr/local && curl -vSL https://nodejs.org/dist/v12.18.4/node-v12.18.4-linux-x64.tar.xz | tar --strip-components 1 -xJ

# Copy source code, be sure config file exists.
COPY . /app

# Setup
RUN cd /app && npm install

# Command line
CMD cd /app && node app
