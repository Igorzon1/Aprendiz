# A Aprendiz

Uma pequena bruxa, dois gatinhos e muita magia.

Jogo 3D de exploração, curto e fofo, feito para rodar no navegador. Você controla a Aprendiz, que acorda em casa com seus gatos Yumi e Petico e sai para explorar o Vale dos Morangos: tem morangos dourados para achar, Sombritos para enfrentar e magos misteriosos esperando além das barreiras mágicas.

## Como rodar

Precisa do [Node.js](https://nodejs.org) 20 ou mais novo.

```bash
npm install
npm run dev
```

Depois abra http://localhost:5173.

Para gerar a versão final, que fica na pasta `dist/`:

```bash
npm run build
```

## Controles

| Tecla | Ação |
|---|---|
| WASD ou setas | Andar |
| Shift | Correr |
| E | Interagir |
| Espaço, J ou clique | Magia (depois de ganhar a varinha) |
| Roda do mouse | Zoom (até o rosto) |
| Botão direito + arrastar | Girar a câmera |
| C | Close no rosto |
| Esc | Pausa |

## Feito com

[Three.js](https://threejs.org) e [Vite](https://vitejs.dev). Os personagens, a casa e o mapa foram gerados por scripts no Blender.
