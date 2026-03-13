FROM node:20-alpine

RUN apk add --no-cache curl

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY src/ ./src/

EXPOSE 8080

CMD ["node", "src/index.js"]
