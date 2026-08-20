# Frequência — seu próprio Discord caseiro

Chat de texto em tempo real + chamada de voz/vídeo + compartilhamento de tela, tudo rodando em um servidor Node.js que você controla.

## O que já funciona
- Login simples por nome de usuário
- Vários canais de texto, com histórico de mensagens
- Vários canais de voz, com lista de quem está em cada um
- Chamada de voz e vídeo (WebRTC, ponto-a-ponto entre os participantes)
- Compartilhamento de tela
- Mutar microfone / ligar câmera

## Como rodar na sua máquina

Pré-requisito: [Node.js](https://nodejs.org) instalado (versão 18+).

```bash
cd discord-clone
npm install
npm start
```

Abra `http://localhost:3000` no navegador. Pronto, já funciona sozinho.

## Como jogar/usar com os amigos (fora da sua rede)

O servidor por padrão só é acessível na sua própria rede (localhost). Para os amigos entrarem de fora, você tem 3 caminhos, do mais simples ao mais "profissional":

### 1. Túnel rápido (bom pra testar hoje)
Instale o [ngrok](https://ngrok.com) (grátis) e rode, com o servidor já ligado:
```bash
ngrok http 3000
```
Ele te dá uma URL pública tipo `https://algumacoisa.ngrok-free.app` — manda ela pros seus amigos. **Importante:** precisa ser `https`, não `http`, porque o navegador só libera câmera/tela/microfone em conexões seguras.

### 2. Hospedar de verdade (uso contínuo)
Suba o projeto em um serviço como Railway, Render, Fly.io ou uma VPS (ex: DigitalOcean, Oracle Cloud free tier). Todos eles já entregam HTTPS automático, que é obrigatório pro WebRTC funcionar fora do localhost.

### 3. Rede local (sem internet nenhuma)
Se todo mundo estiver na mesma rede Wi-Fi (ex: LAN house, mesma casa), basta abrir o `server.js` pro IP da máquina em vez de só localhost — já funciona assim, sem precisar de nada além disso. Descubra seu IP local (`ipconfig` no Windows / `ifconfig` ou `ip a` no Mac/Linux) e os amigos acessam `http://SEU-IP:3000`.

## Sobre o WebRTC e o STUN/TURN

O app usa um servidor STUN público do Google só pra ajudar dois computadores a se encontrarem através do NAT/roteador. Isso resolve a maioria dos casos.

Se algum amigo estiver numa rede muito restritiva (rede corporativa, 4G com CGNAT, etc.) e a chamada não conectar com ele especificamente, a causa é essa — a solução técnica é adicionar um servidor **TURN** (retransmite a mídia quando a conexão direta não é possível). Serviços como [Metered](https://www.metered.ca/tools/openrelay/) e [Twilio](https://www.twilio.com/docs/stun-turn) oferecem TURN gratuito/pago; basta adicionar as credenciais em `ICE_SERVERS` no arquivo `public/client.js`.

## Limitações atuais (é um MVP)

- **Mensagens não são salvas em disco** — ficam em memória, e somem se você reiniciar o servidor. Para persistência real, troque por um banco (Postgres, SQLite, MongoDB).
- **Sem autenticação/senha** — qualquer um com o link e um nome entra. Dá pra adicionar login com senha depois.
- **Chamada em malha (mesh)**: cada participante se conecta diretamente com todos os outros. Funciona bem até uns 4-6 pessoas na mesma call; com mais gente, cada um começa a sentir o peso de manter várias conexões simultâneas. Para escalar além disso, o próximo passo seria usar um SFU (ex: [LiveKit](https://livekit.io), self-hostable) que centraliza os streams em vez de mandar tudo pra todo mundo.
- **Sem servidores múltiplos** (tipo "criar meu próprio servidor" do Discord) — hoje é uma sala só, compartilhada por todo mundo que entra.

## Estrutura do projeto

```
discord-clone/
  server.js           # backend: Express + Socket.io (chat + sinalização WebRTC)
  package.json
  public/
    index.html         # estrutura da página
    style.css           # visual
    client.js           # lógica do chat e das chamadas (WebRTC)
```

## Próximos passos sugeridos (se quiser evoluir)
1. Persistência com banco de dados (mensagens, usuários, canais criados dinamicamente)
2. Autenticação com senha/e-mail
3. Criar/deletar canais e servidores pela interface
4. Trocar a malha WebRTC por um SFU (LiveKit) quando os grupos de call crescerem
5. Notificações e indicador de "está digitando..."
