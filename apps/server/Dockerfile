FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY apps/server/package.json ./apps/server/
COPY packages/database/package.json ./packages/database/
COPY packages/database/prisma ./packages/database/prisma/

RUN npm install --workspace=apps/server --workspace=packages/database

COPY apps/server ./apps/server
COPY packages/database ./packages/database

RUN npx prisma generate --schema=packages/database/prisma/schema.prisma
RUN npm run build -w apps/server

EXPOSE 3001

CMD ["node", "apps/server/dist/index.js"]
