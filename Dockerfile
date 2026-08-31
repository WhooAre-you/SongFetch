FROM node:20-alpine

# Install python3, ffmpeg, curl for yt-dlp compatibility
RUN apk add --no-cache python3 py3-pip ffmpeg curl bash

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

ENV PORT=3000

CMD ["node", "server.js"]
