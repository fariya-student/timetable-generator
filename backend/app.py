from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine
import models

# ✅ Import routes BEFORE using them
from routes import faculty, subjects, rooms, classes, timetable

# Create all database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Timetable Generator API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include all routers
app.include_router(faculty.router, prefix="/api/faculty", tags=["Faculty"])
app.include_router(subjects.router, prefix="/api/subjects", tags=["Subjects"])
app.include_router(rooms.router, prefix="/api/rooms", tags=["Rooms"])
app.include_router(classes.router, prefix="/api/classes", tags=["Classes"])
app.include_router(timetable.router, prefix="/api/timetable", tags=["Timetable"])

@app.get("/")
def root():
    return {"message": "Timetable Generator API is running!"}