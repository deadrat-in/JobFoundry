FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/web/package.json server/web/

RUN npm ci

COPY server/web/ server/web/

WORKDIR /app/server/web
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/server/web/dist /usr/share/nginx/html
COPY server/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]
