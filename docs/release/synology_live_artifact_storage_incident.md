# Synology live-artifact storage incident diagnosis (#1394)

The repository cannot inspect the live Synology host. The incident mechanism is
therefore **UNKNOWN** until an operator records the evidence below. Do not infer
volume deletion from missing files: a changed Compose project, detached volume,
replacement volume, or another mount can present the same symptom.

## Required incident facts

| Fact | Status |
|---|---|
| Compose project name before the affected update | **UNKNOWN — requires Synology host access** |
| Compose project name after the affected update | **UNKNOWN — requires Synology host access** |
| Volume name mounted by the affected/old container | **UNKNOWN — requires Synology host access** |
| Current volume name mounted at `/data` | **UNKNOWN — requires Synology host access** |
| Current `/data` mount source | **UNKNOWN — requires Synology host access** |
| Whether the prior volume still exists | **UNKNOWN — requires Synology host access** |
| Whether known artifact bytes exist in another volume | **UNKNOWN — requires Synology host access** |

## Operator evidence commands

Run these on the Synology before changing Compose configuration. Save the output
with the incident record; it contains host paths, so do not paste it into client
responses.

```bash
cd /volume1/docker/Rhythm/api_server

# Old/current container's Compose identity.
sudo docker inspect rhythm-api --format 'project={{index .Config.Labels "com.docker.compose.project"}} working_dir={{index .Config.Labels "com.docker.compose.project.working_dir"}} config_files={{index .Config.Labels "com.docker.compose.project.config_files"}}'

# Actual volume name and host mount source currently attached at /data.
sudo docker inspect rhythm-api --format '{{range .Mounts}}{{if eq .Destination "/data"}}name={{.Name}} source={{.Source}} type={{.Type}}{{end}}{{end}}'

# All candidate volumes and the containers using them.
sudo docker volume ls --format 'table {{.Name}}\t{{.Driver}}'
sudo docker ps -a --filter volume=rhythm_api_data --format 'table {{.Names}}\t{{.Status}}\t{{.Mounts}}'

# Replace <prior-volume-name> with the name recorded in the incident/deploy log.
sudo docker volume inspect <prior-volume-name>
sudo docker ps -a --filter volume=<prior-volume-name> --format 'table {{.Names}}\t{{.Status}}\t{{.Mounts}}'

# Read-only inventory of candidate artifact trees; repeat for each candidate.
sudo docker run --rm -v <candidate-volume-name>:/candidate:ro alpine:3.20 sh -c 'find /candidate/live-artifacts -type f -print 2>/dev/null | sort'

# Record the post-update Compose identity with the same inspect commands.
sudo docker inspect rhythm-api --format 'project={{index .Config.Labels "com.docker.compose.project"}} working_dir={{index .Config.Labels "com.docker.compose.project.working_dir"}} config_files={{index .Config.Labels "com.docker.compose.project.config_files"}}'
sudo docker inspect rhythm-api --format '{{range .Mounts}}{{if eq .Destination "/data"}}name={{.Name}} source={{.Source}} type={{.Type}}{{end}}{{end}}'
```

Set `RHYTHM_API_DATA_VOLUME` to the **observed existing volume name**, never a
guessed value. The Compose file requires it and therefore cannot silently derive
a replacement name from its directory or project.

At server boot, `LIVE_ARTIFACT_CONTENT_MISSING` in container logs identifies
artifact IDs and bundle/state kinds whose current database pointers have neither
database content nor readable legacy files. It intentionally omits filesystem
paths and credentials.
