FROM node:20-alpine

# Install python3, ffmpeg, curl for yt-dlp compatibility
RUN apk add --no-cache python3 py3-pip ffmpeg curl bash

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Hugging Face Spaces uses port 7860 by default
EXPOSE 7860
ENV PORT=7860

CMD ["node", "server.js"]
