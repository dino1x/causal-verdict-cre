# Full app (UI + /api proxy, feeds, x402 gateway, Claude analyst) in one container.
# Used by the Hugging Face Space; works on any Docker host. Secrets come from the host's environment.
FROM node:22-slim

# Hugging Face runs Spaces as uid 1000, which is the image's `node` user.
USER node
WORKDIR /home/node/app

COPY --chown=node package.json package-lock.json ./
RUN npm ci --include=dev

COPY --chown=node . .
RUN npm run build

ENV PORT=7860
EXPOSE 7860
CMD ["npm", "start"]
