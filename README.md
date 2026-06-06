# 🌾 SpotPalha

Player de música estilo Spotify com reprodução do YouTube sem anúncios e **comandos de voz**.

---

## 🚀 Rodar Localmente

```bash
cd spotpalha
npm install
node server.js
```

Acesse: **http://localhost:3000**

---

## ☁️ Deploy Gratuito no Render.com (acesso pelo celular)

### Passo 1 — Criar conta GitHub e subir o código

1. Crie uma conta em [github.com](https://github.com) (grátis)
2. Crie um repositório novo chamado `spotpalha`
3. Faça upload de todos os arquivos desta pasta

### Passo 2 — Criar conta no Render.com

1. Acesse [render.com](https://render.com) e crie uma conta **gratuita**
2. Clique em **"New +"** → **"Web Service"**
3. Conecte sua conta GitHub
4. Selecione o repositório `spotpalha`

### Passo 3 — Configurar o serviço

| Campo | Valor |
|-------|-------|
| Name | `spotpalha` |
| Runtime | `Node` |
| Build Command | `npm install` |
| Start Command | `node server.js` |
| Plan | **Free** |

5. Clique em **"Create Web Service"**
6. Aguarde o deploy (~2-3 minutos)

### Passo 4 — Acessar pelo celular

Seu app estará disponível em:
```
https://spotpalha.onrender.com
```

> ⚠️ **Nota:** No plano gratuito do Render, o servidor "dorme" após 15 minutos sem uso. A primeira visita pode demorar ~30 segundos para acordar.

---

## 🎙️ Comandos de Voz

Clique no ícone 🎙️ na barra superior ou segure `Espaço` por 0.5s e fale:

| Comando | Ação |
|---------|------|
| `palha, toque [nome da música]` | Busca e toca a música |
| `palha, buscar [nome]` | Busca sem tocar |
| `palha, pause` | Pausa a música |
| `palha, play` | Retoma a música |
| `palha, próxima` | Próxima da fila |
| `palha, anterior` | Música anterior |
| `palha, volume alto` | Aumenta volume |
| `palha, volume baixo` | Diminui volume |
| `palha, aleatório` | Ativa/desativa shuffle |
| `palha, repetir` | Alterna modo repetição |
| `palha, ajuda` | Mostra todos os comandos |

> 🎙️ Funciona no Chrome (PC e Android). No iPhone, use o Safari.

---

## 🛠️ Stack Técnica

- **Frontend:** HTML + CSS + JavaScript puro
- **Backend:** Node.js + Express
- **Áudio:** `@distube/ytdl-core` (fork ativo do ytdl-core)
- **Busca:** `youtube-search-api` (sem API key)
- **Voz:** Web Speech API (nativa do navegador, gratuita)
- **Hospedagem:** Render.com (gratuito)
