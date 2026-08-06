# syntax=docker/dockerfile:1

# ---- build ----
FROM node:24 AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
# SQLite lives on a mounted volume so the words survive restarts/redeploys.
ENV DB_PATH=/app/data/words.db
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
VOLUME ["/app/data"]
EXPOSE 4000
CMD ["node", "dist/index.js"]
