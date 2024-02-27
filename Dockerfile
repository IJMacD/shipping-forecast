FROM node:21-alpine
WORKDIR /app
COPY package.json yarn.lock /app/
RUN ["yarn", "install", "--frozen-lockfile"]
COPY server.js /app/
CMD ["node", "server.js"]