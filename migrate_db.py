import sqlite3

def migrate_database():
    DB_PATH = "db.sqlite"
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    print("🛠️ VMS 데이터베이스 마이그레이션을 시작합니다...")

    # 1. 새로 추가된 컬럼들을 기존 테이블에 삽입
    new_columns = [
        ("contact", "TEXT"),
        ("vehicle_no", "TEXT"),
        ("manager_text", "TEXT DEFAULT ''"),
        ("status", "TEXT DEFAULT '사전예약'"),
        ("region", "TEXT DEFAULT '테크센터'")
    ]

    for col_name, col_type in new_columns:
        try:
            cursor.execute(f"ALTER TABLE visitor_log ADD COLUMN {col_name} {col_type}")
            print(f"✅ 컬럼 추가 완료: {col_name}")
        except sqlite3.OperationalError as e:
            # 컬럼이 이미 존재하면 에러가 발생하므로 무시하고 넘어갑니다.
            print(f"⚠️ 컬럼 통과 (이미 존재함): {col_name}")

    # 2. 기존 데이터의 status(상태값) 현행화
    # - 입실 시간이 있고 퇴실 시간이 없으면 -> '입실완료'
    # - 퇴실 시간까지 있으면 -> '퇴실완료'
    cursor.execute("""
        UPDATE visitor_log 
        SET status = '입실완료' 
        WHERE checkin_time IS NOT NULL AND checkin_time != '' 
          AND (checkout_time IS NULL OR checkout_time = '')
    """)
    
    cursor.execute("""
        UPDATE visitor_log 
        SET status = '퇴실완료' 
        WHERE checkout_time IS NOT NULL AND checkout_time != ''
    """)

    conn.commit()
    conn.close()
    print("🎉 DB 마이그레이션이 성공적으로 완료되었습니다! 이제 새로운 app.py를 실행하셔도 됩니다.")

if __name__ == "__main__":
    migrate_database()