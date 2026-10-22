FROM golang:1.23-alpine AS build
WORKDIR /src
RUN apk add --no-cache git ca-certificates gcc musl-dev
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/server
FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata && adduser -D -H appuser && mkdir -p /data && chown appuser:appuser /data
WORKDIR /app
COPY --from=build /out/api /app/api
USER appuser
EXPOSE 8080
ENTRYPOINT ["/app/api"]
