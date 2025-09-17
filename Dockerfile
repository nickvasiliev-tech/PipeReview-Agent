
# Simple Dockerfile (optional). Render can deploy directly without Docker.
FROM node:20-bookworm

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

ENV PORT=8080
EXPOSE 8080
CMD ["npm","start"]
