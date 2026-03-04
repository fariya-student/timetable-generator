from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, Text, Float
from sqlalchemy.orm import relationship
from database import Base

class Faculty(Base):
    __tablename__ = "faculty"
    id = Column(Integer, primary_key=True, index=True)
    faculty_id = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    expertise = Column(String, nullable=False)
    availability = Column(Text, nullable=False)  # JSON string

class Subject(Base):
    __tablename__ = "subjects"
    id = Column(Integer, primary_key=True, index=True)
    subject_code = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    weekly_hours = Column(Integer, nullable=False)
    subject_type = Column(String, nullable=False)  # Lab or Theory
    faculty_id = Column(String, ForeignKey("faculty.faculty_id"))

class Room(Base):
    __tablename__ = "rooms"
    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(String, unique=True, nullable=False)
    capacity = Column(Integer, nullable=False)
    room_type = Column(String, nullable=False)  # Lab or Theory

class ClassSection(Base):
    __tablename__ = "classes"
    id = Column(Integer, primary_key=True, index=True)
    class_id = Column(String, unique=True, nullable=False)
    section_name = Column(String, nullable=False)
    subject_codes = Column(Text, nullable=False)  # JSON list of subject codes

class Timetable(Base):
    __tablename__ = "timetable"
    id = Column(Integer, primary_key=True, index=True)
    class_id = Column(String, nullable=False)
    subject_code = Column(String, nullable=False)
    faculty_id = Column(String, nullable=False)
    room_id = Column(String, nullable=False)
    day = Column(String, nullable=False)
    period = Column(Integer, nullable=False)

class GenerationLog(Base):
    __tablename__ = "generation_logs"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(String, nullable=False)
    execution_time = Column(Float, nullable=False)
    status = Column(String, nullable=False)  # success or failed
    soft_constraint_score = Column(Float, nullable=False)
    message = Column(Text, nullable=True)