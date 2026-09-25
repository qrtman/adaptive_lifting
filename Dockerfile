FROM node:22-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_BACKEND_URL=
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}
RUN npm run build

FROM caddy:2-alpine
COPY --from=frontend-build /app/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
