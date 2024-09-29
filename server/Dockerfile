# ================= builder =================
FROM golang:1.23-alpine as builder

WORKDIR /app

# download dependency
COPY go.* ./
RUN go mod download

# copy the source file
COPY ./cmd/ ./cmd/
COPY ./pkg/ ./pkg/

# build the app
RUN go build -o ./bin/server.bin ./cmd/server.go

# ================= runner =================
FROM golang:1.23-alpine as runner

WORKDIR /app

# copy the binary file and env
COPY --from=builder /app/bin/server.bin ./server.bin

EXPOSE 8080

CMD sh -c ./server.bin
