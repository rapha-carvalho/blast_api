#!/usr/bin/env sh
set -eu

docker compose --env-file .env pull
docker compose --env-file .env up -d --remove-orphans
