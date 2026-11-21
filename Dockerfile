FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p storage/uploads storage/state storage/tmp \
    && chown -R node:node /app

USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3200
EXPOSE 3200

CMD ["sh", "-c", "npm run migrate && npm start"]
