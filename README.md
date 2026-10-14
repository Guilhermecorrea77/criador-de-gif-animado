# Criador de GIF Animado

Transforme fotos ou trechos de vídeo em GIFs animados direto no navegador. Nada é enviado para servidores: todo o processamento acontece no seu aparelho.

**Acesse:** https://guilhermecorrea77.github.io/criador-de-gif-animado/

## Recursos

- **Importação**: arraste e solte, clique para escolher ou cole com Ctrl+V (até 60 quadros, ordenados pelo nome do arquivo)
- **GIF animado → quadros**: abra um GIF existente para editar (Chrome, Edge e navegadores com WebCodecs)
- **Vídeo → GIF**: escolha o trecho e quantos quadros por segundo extrair
- **Câmera**: foto única ou sequência automática com contagem regressiva, alternando entre câmera frontal e traseira
- **Desfazer/refazer** (Ctrl+Z / Ctrl+Y) em qualquer alteração de quadros
- **Quadros**: reordene arrastando (ou com as setas no celular), duplique, remova e defina um tempo próprio para cada quadro
- **Recorte**: por quadro ou em todos de uma vez, com proporções prontas, giro de 90° e espelhamento
- **Formato**: proporção (original, 1:1, 4:3, 3:4, 16:9, 9:16), largura de 240 a 1080 px, modo preencher ou encaixar com cor de fundo
- **Filtros**: P&B, sépia, vintage, vívido, quente, frio, além de brilho, contraste e saturação
- **Texto/legenda** com posição, tamanho, cor e contorno
- **Transição** com esmaecimento suave entre quadros
- **Tempo**: velocidade, boomerang, ordem inversa e número de repetições
- **Qualidade**: leve, equilibrada ou máxima, com dithering opcional
- **Pré-visualização ao vivo**, idêntica ao GIF final
- **Resultado**: mostra tamanho, dimensões e duração; permite baixar com nome personalizado ou compartilhar (no celular)
- **Exportar como vídeo** (MP4 ou WebM, conforme o navegador), ideal para Stories e WhatsApp
- **Rápido**: só re-renderiza os quadros afetados por cada ajuste; mudar velocidade ou repetição não reprocessa nada
- **Funciona offline** depois do primeiro acesso (PWA, pode ser instalado na tela inicial)

Atalhos: `Espaço` reproduz/pausa · `Ctrl+Z`/`Ctrl+Y` desfaz/refaz · `Delete` remove o quadro selecionado · `Esc` tira a seleção · duplo clique em um quadro abre o recorte.

## Estrutura

```
index.html            página única
css/style.css         estilos (responsivo, tema escuro)
js/app.js             interface e estado
js/render.js          recorte, enquadramento, filtros, texto e sequência
js/encoder.js         geração do GIF (gif.js em Web Workers)
js/video.js           extração de quadros de vídeo
js/gifdecode.js       leitura de GIFs animados
js/videoexport.js     exportação em MP4/WebM
js/camera.js          captura pela câmera
vendor/               gif.js 0.2.0 e Cropper.js 1.6.2 (MIT)
sw.js                 service worker (uso offline)
manifest.webmanifest  instalação como app
```

Não precisa de build nem de `npm install`: são arquivos estáticos.

## Rodar localmente

O app usa módulos ES e Web Workers, então precisa ser servido por HTTP (abrir o arquivo direto não funciona):

```bash
python3 -m http.server 8000
# acesse http://localhost:8000
```

## Publicar no GitHub Pages

Em **Settings → Pages**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`.

## Créditos

- [gif.js](https://github.com/jnordberg/gif.js) — Johan Nordberg (MIT)
- [Cropper.js](https://github.com/fengyuanchen/cropperjs) — Chen Fengyuan (MIT)
