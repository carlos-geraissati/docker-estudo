from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import httpx
from typing import Optional
import os

app = FastAPI(title="Lap Timer - SpeedHive", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_URL = "https://eventresults-api.speedhive.com/api/v0.2.3/eventresults"
TIMEOUT = 30.0


async def fetch_speedhive(path: str, params: Optional[dict] = None):
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        url = f"{BASE_URL}{path}"
        resp = await client.get(url, params=params)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        return resp.json()


@app.get("/api/events")
async def get_events(
    sport: Optional[str] = Query(None, description="Karting, Car, Bike, MX, etc."),
    country: Optional[str] = Query(None),
    count: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    params = {"count": count, "offset": offset}
    if sport:
        params["sport"] = sport
    if country:
        params["country"] = country
    return await fetch_speedhive("/events", params)


@app.get("/api/events/{event_id}")
async def get_event(event_id: int, sessions: bool = Query(True)):
    params = {"sessions": str(sessions).lower()}
    return await fetch_speedhive(f"/events/{event_id}", params)


@app.get("/api/sessions/{session_id}/classification")
async def get_classification(session_id: int):
    return await fetch_speedhive(f"/sessions/{session_id}/classification")


@app.get("/api/sessions/{session_id}/lapchart")
async def get_lapchart(session_id: int):
    return await fetch_speedhive(f"/sessions/{session_id}/lapchart")


@app.get("/api/sessions/{session_id}/lapdata/{finish_position}/laps")
async def get_lapdata(
    session_id: int,
    finish_position: int,
    count: Optional[int] = Query(None),
    offset: Optional[int] = Query(None),
):
    params = {}
    if count is not None:
        params["count"] = count
    if offset is not None:
        params["offset"] = offset
    return await fetch_speedhive(
        f"/sessions/{session_id}/lapdata/{finish_position}/laps", params
    )


FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
async def root():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
