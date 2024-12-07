FROM node:22
COPY package.json /app/
COPY package-lock.json /app/
RUN cd /app && npm install
COPY . /app/
WORKDIR /app
RUN npm run build

FROM node:22
RUN apt update && apt install -y ffmpeg && rm -rf /var/lib/apt/lists/*
COPY --from=0 /app/dist /app/dist
ENTRYPOINT ["node", "/app/dist/index.js"]
