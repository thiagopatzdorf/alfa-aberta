# alfa-aberta no cluster k3s (sistema de apps/sistemas, imagem publicada pelo cd-imagens-k3s.yml).
# Mesma base Node por digest dos outros sistemas Node da casa. Sem dependência de npm: o servidor,
# o motor e o MCP usam só a biblioteca do Node. Processo sem root (uid 10001) e raiz só leitura:
# tarefas e resultados ficam em memória (1 h), nada é gravado em disco.
#
#   docker build -t alfa-aberta apps/sistemas/alfa-aberta
#   docker run --rm -p 8080:8080 --read-only alfa-aberta
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json sistema.json LICENSE ./
COPY src ./src
COPY public ./public
USER 10001
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/servidor.mjs"]
