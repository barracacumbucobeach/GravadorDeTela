# Gravador de Tela

Aplicativo desktop (Windows, macOS e Linux) para gravar a tela e editar o vídeo depois, com uma interface inspirada no **Windows 11 / Fluent Design**: cantos arredondados, cores de acento, tema claro/escuro e barra de título customizada.

Construído com [Electron](https://www.electronjs.org/) + JavaScript puro (sem frameworks de UI) e [ffmpeg](https://ffmpeg.org/) (via `ffmpeg-static`) para gerar sempre arquivos **.mp4**.

## Funcionalidades

### Gravação
- Escolha entre gravar a **tela inteira** ou uma **janela específica**, com miniaturas de pré-visualização.
- Grave **com ou sem áudio**: nenhum, apenas microfone, apenas áudio do sistema, ou os dois misturados.
- **Acompanhar o cursor do mouse**: ao gravar uma tela inteira, o app pode aplicar um zoom suave que segue o ponteiro automaticamente — ideal para gravar tutoriais e instruções apontando elementos na tela. O nível de zoom é ajustável.
- Contagem regressiva antes de iniciar, cronômetro, pausar/retomar e um indicativo flutuante de "gravando" visível em qualquer tela do app.
- Toda gravação é convertida e salva automaticamente em **.mp4** (H.264/AAC) na pasta `Vídeos/Gravador de Tela`.

### Editor de vídeo
- Importe qualquer vídeo (`.mp4`, `.webm`, `.mov`, `.mkv`) ou abra uma gravação existente direto da biblioteca.
- **Cortes**: marque o início e o fim de um trecho para removê-lo, além de arrastar as alças para aparar o início/fim do vídeo.
- **Zoom**: crie regiões de zoom com entrada/saída suaves; arraste o alvo sobre o vídeo para escolher o ponto de foco e ajuste a intensidade.
- **Caixa de texto**: adicione textos arrastáveis e redimensionáveis, com cor de texto/fundo e período de exibição configuráveis.
- **Setas**: aponte para qualquer elemento da tela com setas coloridas de ponta arrastável.
- Linha do tempo com miniaturas, trilhas separadas para zoom e para texto/setas, e painel de propriedades contextual.
- **Exportar** gera um novo arquivo `.mp4` já com todas as edições aplicadas (cortes, zoom, textos e setas "queimados" no vídeo), sem alterar o arquivo original.

### Biblioteca
- Lista todas as gravações com miniatura, duração, data e tamanho.
- Renomear (clique no nome), reproduzir, editar, revelar no explorador de arquivos e excluir.
- Busca rápida por nome e atalho para abrir a pasta de gravações.

## Requisitos

- [Node.js](https://nodejs.org/) 18 ou superior (inclui o `npm`).
- Windows, macOS ou Linux com suporte a captura de tela.

> **Áudio do sistema**: a captura de áudio do sistema (loopback) é suportada nativamente pelo Chromium/Electron no **Windows** e no **macOS 13+**. Em outras plataformas, se não estiver disponível, o app avisa e grava apenas com o microfone (se selecionado).
>
> **Acompanhar o cursor**: disponível apenas ao gravar uma **tela inteira** (não uma janela específica), pois depende de mapear a posição do cursor para a área capturada.

## Instalação

```bash
npm install
```

Isso instala o Electron e o `ffmpeg-static` (baixa um binário do ffmpeg para a sua plataforma automaticamente).

## Executar em modo de desenvolvimento

```bash
npm start
```

## Ícone

O ícone do app já está pronto em `build/icon.ico` (Windows, multi-resolução: 16 a 256px) e `build/icon.png` (1024×1024, usado como base para macOS/Linux). A arte-fonte editável está em `assets/icon-source.svg`. Não é preciso gerar nada manualmente — o `electron-builder` já usa esses arquivos automaticamente.

## Gerar o instalador .exe (Windows)

```bash
npm install
npm run dist
```

Isso roda o [electron-builder](https://www.electron.build/) (já configurado em `package.json`) e gera, dentro de `dist/`:

- `Gravador de Tela Setup <versão>.exe` — instalador NSIS (o que você normalmente quer distribuir)
- `win-unpacked/Gravador de Tela.exe` — versão "portátil", já pronta para rodar sem instalar

**Rode esse comando em uma máquina Windows** — é o caminho mais simples e não exige nada extra.

Se preferir empacotar para Windows a partir do Linux ou macOS (cross-build), é preciso ter o [Wine](https://www.winehq.org/) instalado (`electron-builder` usa o Wine para gravar o ícone e as informações da versão dentro do `.exe`); sem o Wine, o comando falha só nessa etapa final de assinatura/recursos, mesmo já tendo empacotado o app corretamente. Nesse caso:

```bash
# Linux (Debian/Ubuntu)
sudo apt-get install wine
npm run dist -- --win
```

Para gerar instaladores de macOS (`.dmg`) ou Linux (`AppImage`), use `npm run dist -- --mac` ou `npm run dist -- --linux` (rodando na respectiva plataforma).

## Estrutura do projeto

```
GravadorDeTela/
├── main.js               # Processo principal do Electron (janelas, IPC, ffmpeg, arquivos)
├── preload.js             # Ponte segura (contextBridge) entre a interface e o processo principal
├── src/
│   ├── index.html         # Estrutura da interface (titlebar, navegação, telas)
│   ├── styles/
│   │   ├── fluent.css      # Tokens de design Fluent/Windows 11 (cores, componentes)
│   │   └── app.css         # Layout específico do app
│   └── renderer/
│       ├── app.js          # Inicialização, navegação entre telas, tema
│       ├── recorder.js     # Captura de tela/áudio, zoom que segue o cursor, gravação
│       ├── editor.js        # Timeline, cortes, zoom, texto, setas e exportação
│       ├── library.js       # Biblioteca de gravações
│       ├── icons.js         # Ícones SVG embutidos (sem dependência externa)
│       └── utils.js         # Formatação, modais, toasts e helpers compartilhados
└── package.json
```

## Onde os vídeos são salvos

- Gravações: pasta `Vídeos/Gravador de Tela` do usuário (criada automaticamente).
- Exportações do editor: você escolhe o local e o nome ao clicar em **Exportar vídeo**.

## Privacidade

O aplicativo não envia nenhum dado pela internet: gravação, conversão e edição acontecem inteiramente no seu computador.
