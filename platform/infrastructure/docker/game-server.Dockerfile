# Game server image. Build context: the repository root (the game server
# depends on the engine there):
#   docker build -f platform/infrastructure/docker/game-server.Dockerfile .
FROM rust:1-bookworm AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends protobuf-compiler \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN cd platform \
 && cargo build --release -p platform-game-server \
 && cp /src/target/release/game-server /usr/local/bin/game-server

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home /srv game
COPY --from=build /usr/local/bin/game-server /usr/local/bin/game-server
COPY platform/game /srv/content
ENV GAME_CONTENT_DIR=/srv/content \
    GAME_SAVE_DIR=/srv/worlds \
    GAME_PORT=4000
RUN mkdir -p /srv/worlds && chown game /srv/worlds
USER game
VOLUME ["/srv/worlds"]
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=60s \
  CMD curl -fsS http://localhost:4000/health || exit 1
ENTRYPOINT ["/usr/local/bin/game-server"]
