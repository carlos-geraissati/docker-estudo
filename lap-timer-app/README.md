# Lap Timer - Controle de Tempos de Volta

Aplicação web para controle e análise de tempos de volta de pilotos, utilizando dados do [SpeedHive / MyLaps](https://speedhive.mylaps.com).

## Funcionalidades

- **Navegação por Eventos**: Browse de eventos recentes filtrados por modalidade (Kart, Carro, Moto, Motocross)
- **Sessões**: Visualização de todas as sessões de um evento (treinos, classificação, corrida)
- **Classificação**: Tabela completa de resultados com posições, tempos, voltas e gaps
- **Análise de Voltas**: Dados detalhados de cada volta por piloto, incluindo:
  - Tempo de volta e diferença para a melhor
  - Velocidade por volta
  - Posição na pista
  - Gaps para pilotos à frente e atrás
- **Gráficos**: Visualização de tempos de volta e velocidade com Chart.js
- **Estatísticas**: Melhor volta, média, consistência do piloto
- **Design Responsivo**: Interface adaptada para desktop e dispositivos móveis

## Tecnologias

### Backend
- **Python 3.10+**
- **FastAPI** - Framework web assíncrono
- **HTTPX** - Cliente HTTP assíncrono
- **Uvicorn** - Servidor ASGI

### Frontend
- **HTML5 / CSS3 / JavaScript** (Vanilla)
- **Chart.js** - Gráficos de tempos de volta
- **Google Fonts** (Orbitron + Inter)

### API
- **SpeedHive Event Results API** (`eventresults-api.speedhive.com`)
  - Endpoints: eventos, sessões, classificação, dados de volta

## Como Executar

### Opção 1: Executar localmente

```bash
cd lap-timer-app/backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Acesse: http://localhost:8000

### Opção 2: Docker

```bash
cd lap-timer-app
docker build -t lap-timer .
docker run -p 8000:8000 lap-timer
```

Acesse: http://localhost:8000

## Estrutura do Projeto

```
lap-timer-app/
├── backend/
│   ├── main.py              # API FastAPI (proxy para SpeedHive)
│   └── requirements.txt     # Dependências Python
├── frontend/
│   ├── index.html            # Página principal
│   ├── styles.css            # Estilos (tema dark racing)
│   └── app.js                # Lógica da aplicação
├── Dockerfile                # Container Docker
└── README.md                 # Documentação
```

## Screenshots

A aplicação possui uma interface dark com tema de automobilismo, incluindo:
- Lista de eventos com cards informativos
- Tabela de classificação com destaque para pódio
- Gráfico de evolução de tempos de volta
- Detalhes completos de cada volta

## API Endpoints (Backend)

| Endpoint | Descrição |
|----------|-----------|
| `GET /api/events` | Lista eventos (filtros: sport, count, offset) |
| `GET /api/events/{id}` | Detalhes do evento com sessões |
| `GET /api/sessions/{id}/classification` | Classificação/resultados |
| `GET /api/sessions/{id}/lapdata/{pos}/laps` | Dados de volta por piloto |
| `GET /api/sessions/{id}/lapchart` | Gráfico de voltas da sessão |
