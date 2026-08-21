#!/bin/sh
set -eu

mode=${1:-}
manifest=${2:-.live-artifact-storage.sha256}
container=${RHYTHM_API_CONTAINER:-rhythm-api}
expected_volume=${RHYTHM_API_DATA_VOLUME:?Set RHYTHM_API_DATA_VOLUME to the existing API data volume name}

mounted_volume=$(sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$container")
[ "$mounted_volume" = "$expected_volume" ] || {
  printf 'ERROR: %s mounts volume %s at /data; expected %s\n' "$container" "$mounted_volume" "$expected_volume" >&2
  exit 1
}
sudo docker exec "$container" sh -c 'test -r /data/live-artifacts && test -w /data/live-artifacts'

case "$mode" in
  pre)
    tmp="${manifest}.tmp"
    # ponytail: immutable content hashes need only a sorted checksum manifest.
    sudo docker exec "$container" sh -c 'cd /data/live-artifacts && find . -type f -exec sha256sum {} + | sort' > "$tmp"
    mv "$tmp" "$manifest"
    printf 'PRE check passed; checksum manifest saved to %s\n' "$manifest"
    ;;
  post)
    [ -f "$manifest" ] || { printf 'ERROR: PRE manifest %s is missing\n' "$manifest" >&2; exit 1; }
    sudo docker exec -i "$container" sh -c 'cd /data/live-artifacts && sha256sum -c -' < "$manifest"
    printf 'POST check passed; expected volume and known bytes are readable\n'
    ;;
  *)
    printf 'Usage: %s pre|post [manifest-file]\n' "$0" >&2
    exit 2
    ;;
esac
