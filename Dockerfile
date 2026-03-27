FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY client/package*.json ./client/

RUN npm ci
RUN npm ci --prefix client

COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/server.js ./server.js
COPY --from=build /app/src ./src
COPY --from=build /app/client/dist ./client/dist

EXPOSE 3001
CMD ["node", "server.js"]
