FROM node:22-trixie-slim
WORKDIR /app

# HUSKY=0: у образі немає git-хуків; MIGRATE_ON_START=false: міграції робить entrypoint
ENV NODE_ENV=production \
    HUSKY=0 \
    PORT=3000 \
    DB_PATH=/data/database.sqlite \
    MIGRATE_ON_START=false

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# SHA коміта потрапляє в образ під час збірки (ендпоінт /version)
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# через sh, щоб не залежати від біта виконання файлу (з Windows він не зберігається)
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
