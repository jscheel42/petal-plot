# Build stage: install deps (compiling better-sqlite3 if no prebuild) and build the app.
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage: adapter-node server + native module + migrations only.
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
	PORT=3000 \
	PIXEL_DB=/data/pixel.db
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY drizzle ./drizzle
COPY package.json ./
EXPOSE 3000
VOLUME /data
CMD ["node", "build"]
