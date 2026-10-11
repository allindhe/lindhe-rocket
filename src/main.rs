use rocket::{
    fs::{relative, FileServer},
    get,
    http::{Cookie, CookieJar, SameSite, Status},
    launch, patch, post, routes,
    serde::json::Json,
    State,
};
use rocket_dyn_templates::{context, Template};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use subtle::ConstantTimeEq;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

struct AppState {
    database: PgPool,
    access_code: String,
}

#[derive(Deserialize)]
struct AccessRequest {
    code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldUpdate {
    round_id: String,
    entity_type: String,
    entity_id: String,
    field: String,
    value: Value,
    player_id: Option<String>,
    hole_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScorecardSnapshot {
    round_id: String,
    course_name: String,
    players: Vec<PlayerSnapshot>,
    holes: Vec<HoleSnapshot>,
}

#[derive(Serialize)]
struct PlayerSnapshot {
    id: String,
    name: String,
    scores: std::collections::HashMap<String, i16>,
}

#[derive(Serialize)]
struct HoleSnapshot {
    id: String,
    par: i16,
}

#[get("/")]
async fn index() -> Template {
    Template::render("index", context! {})
}

#[get("/golf")]
async fn golf() -> Template {
    Template::render("golf", context! {})
}

#[post("/api/access", data = "<request>")]
fn unlock(
    request: Json<AccessRequest>,
    state: &State<AppState>,
    cookies: &CookieJar<'_>,
) -> Status {
    if request
        .code
        .as_bytes()
        .ct_eq(state.access_code.as_bytes())
        .unwrap_u8()
        != 1
    {
        return Status::Unauthorized;
    }

    cookies.add_private(
        Cookie::build(("scorecard_access", "authorized"))
            .path("/")
            .http_only(true)
            .secure(!cfg!(debug_assertions))
            .same_site(SameSite::Strict)
            .build(),
    );
    Status::NoContent
}

#[get("/api/scorecard")]
async fn load_scorecard(
    state: &State<AppState>,
    cookies: &CookieJar<'_>,
) -> Result<Json<ScorecardSnapshot>, Status> {
    if !is_authorized(cookies) {
        return Err(Status::Unauthorized);
    }

    let round = sqlx::query("SELECT id, course_name FROM scorecard_rounds WHERE id = $1")
        .bind("round-demo-001")
        .fetch_one(&state.database)
        .await
        .map_err(|_| Status::InternalServerError)?;

    let round_id: String = round
        .try_get("id")
        .map_err(|_| Status::InternalServerError)?;
    let course_name: String = round
        .try_get("course_name")
        .map_err(|_| Status::InternalServerError)?;
    let player_rows = sqlx::query(
        "SELECT player_id, name FROM scorecard_players \
         WHERE round_id = $1 ORDER BY player_id",
    )
    .bind(&round_id)
    .fetch_all(&state.database)
    .await
    .map_err(|_| Status::InternalServerError)?;
    let mut players = player_rows
        .into_iter()
        .map(|row| {
            Ok(PlayerSnapshot {
                id: row
                    .try_get("player_id")
                    .map_err(|_| Status::InternalServerError)?,
                name: row
                    .try_get("name")
                    .map_err(|_| Status::InternalServerError)?,
                scores: std::collections::HashMap::new(),
            })
        })
        .collect::<Result<Vec<_>, Status>>()?;

    let hole_rows = sqlx::query(
        "SELECT hole_id, par FROM scorecard_holes \
         WHERE round_id = $1 ORDER BY hole_number",
    )
    .bind(&round_id)
    .fetch_all(&state.database)
    .await
    .map_err(|_| Status::InternalServerError)?;
    let holes = hole_rows
        .into_iter()
        .map(|row| {
            Ok(HoleSnapshot {
                id: row
                    .try_get("hole_id")
                    .map_err(|_| Status::InternalServerError)?,
                par: row
                    .try_get("par")
                    .map_err(|_| Status::InternalServerError)?,
            })
        })
        .collect::<Result<Vec<_>, Status>>()?;

    let score_rows = sqlx::query(
        "SELECT player_id, hole_id, strokes FROM scorecard_scores \
         WHERE round_id = $1",
    )
    .bind(&round_id)
    .fetch_all(&state.database)
    .await
    .map_err(|_| Status::InternalServerError)?;
    for row in score_rows {
        let player_id: String = row
            .try_get("player_id")
            .map_err(|_| Status::InternalServerError)?;
        let hole_id: String = row
            .try_get("hole_id")
            .map_err(|_| Status::InternalServerError)?;
        let strokes: i16 = row
            .try_get("strokes")
            .map_err(|_| Status::InternalServerError)?;
        if let Some(player) = players.iter_mut().find(|player| player.id == player_id) {
            player.scores.insert(hole_id, strokes);
        }
    }

    Ok(Json(ScorecardSnapshot {
        round_id,
        course_name,
        players,
        holes,
    }))
}

#[patch("/api/scorecard/field", data = "<update>")]
async fn update_scorecard_field(
    update: Json<FieldUpdate>,
    state: &State<AppState>,
    cookies: &CookieJar<'_>,
) -> Status {
    if !is_authorized(cookies) {
        return Status::Unauthorized;
    }

    let update = update.into_inner();
    if update.round_id != "round-demo-001" {
        return Status::NotFound;
    }

    let result = match (update.entity_type.as_str(), update.field.as_str()) {
        ("round", "courseName") if update.entity_id == update.round_id => {
            let Some(value) = update.value.as_str().filter(|value| value.len() <= 100) else {
                return Status::BadRequest;
            };
            sqlx::query("UPDATE scorecard_rounds SET course_name = $1 WHERE id = $2")
                .bind(value)
                .bind(&update.round_id)
                .execute(&state.database)
                .await
        }
        ("player", "name") if valid_player_id(&update.entity_id) => {
            let Some(value) = update
                .value
                .as_str()
                .filter(|value| value.trim().len() <= 24)
            else {
                return Status::BadRequest;
            };
            sqlx::query(
                "UPDATE scorecard_players SET name = $1 \
                 WHERE round_id = $2 AND player_id = $3",
            )
            .bind(value)
            .bind(&update.round_id)
            .bind(&update.entity_id)
            .execute(&state.database)
            .await
        }
        ("hole", "par") if valid_hole_id(&update.entity_id) => {
            let Some(value) = update
                .value
                .as_i64()
                .filter(|value| (3..=5).contains(value))
            else {
                return Status::BadRequest;
            };
            sqlx::query(
                "UPDATE scorecard_holes SET par = $1 \
                 WHERE round_id = $2 AND hole_id = $3",
            )
            .bind(value as i16)
            .bind(&update.round_id)
            .bind(&update.entity_id)
            .execute(&state.database)
            .await
        }
        ("score", "strokes") => {
            let (Some(player_id), Some(hole_id)) = (&update.player_id, &update.hole_id) else {
                return Status::BadRequest;
            };
            if !valid_player_id(player_id) || !valid_hole_id(hole_id) {
                return Status::BadRequest;
            }
            if update.value.is_null() {
                sqlx::query(
                    "DELETE FROM scorecard_scores \
                     WHERE round_id = $1 AND player_id = $2 AND hole_id = $3",
                )
                .bind(&update.round_id)
                .bind(player_id)
                .bind(hole_id)
                .execute(&state.database)
                .await
            } else {
                let Some(value) = update
                    .value
                    .as_i64()
                    .filter(|value| (1..=99).contains(value))
                else {
                    return Status::BadRequest;
                };
                sqlx::query(
                    "INSERT INTO scorecard_scores (round_id, player_id, hole_id, strokes) \
                     VALUES ($1, $2, $3, $4) \
                     ON CONFLICT (round_id, player_id, hole_id) \
                     DO UPDATE SET strokes = EXCLUDED.strokes",
                )
                .bind(&update.round_id)
                .bind(player_id)
                .bind(hole_id)
                .bind(value as i16)
                .execute(&state.database)
                .await
            }
        }
        _ => return Status::BadRequest,
    };

    match result {
        Ok(result) if result.rows_affected() > 0 || update.field == "strokes" => Status::NoContent,
        Ok(_) => Status::NotFound,
        Err(_) => Status::InternalServerError,
    }
}

#[post("/api/scorecard/clear", data = "<request>")]
async fn clear_scorecard(
    request: Json<AccessRequest>,
    state: &State<AppState>,
    cookies: &CookieJar<'_>,
) -> Status {
    if !is_authorized(cookies)
        || request
            .code
            .as_bytes()
            .ct_eq(state.access_code.as_bytes())
            .unwrap_u8()
            != 1
    {
        return Status::Unauthorized;
    }

    match sqlx::query("DELETE FROM scorecard_scores WHERE round_id = $1")
        .bind("round-demo-001")
        .execute(&state.database)
        .await
    {
        Ok(_) => Status::NoContent,
        Err(_) => Status::InternalServerError,
    }
}

fn is_authorized(cookies: &CookieJar<'_>) -> bool {
    cookies
        .get_private("scorecard_access")
        .is_some_and(|cookie| cookie.value() == "authorized")
}

fn valid_player_id(value: &str) -> bool {
    matches!(value, "player-1" | "player-2" | "player-3" | "player-4")
}

fn valid_hole_id(value: &str) -> bool {
    matches!(
        value,
        "hole-1"
            | "hole-2"
            | "hole-3"
            | "hole-4"
            | "hole-5"
            | "hole-6"
            | "hole-7"
            | "hole-8"
            | "hole-9"
    )
}

#[launch]
async fn rocket() -> _ {
    dotenvy::dotenv().ok();

    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set in the environment or local .env file");
    let access_code = std::env::var("SCORECARD_ACCESS_CODE")
        .expect("SCORECARD_ACCESS_CODE must be set in the environment or local .env file");
    let secret_key = std::env::var("ROCKET_SECRET_KEY")
        .expect("ROCKET_SECRET_KEY must be set in the environment or local .env file");
    if secret_key.is_empty() {
        panic!("ROCKET_SECRET_KEY must not be empty");
    }

    let database = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("failed to connect to PostgreSQL using DATABASE_URL");
    MIGRATOR
        .run(&database)
        .await
        .expect("failed to run PostgreSQL migrations");

    rocket::build()
        .manage(AppState {
            database,
            access_code,
        })
        .mount(
            "/",
            routes![
                index,
                golf,
                unlock,
                load_scorecard,
                update_scorecard_field,
                clear_scorecard
            ],
        )
        .attach(Template::fairing())
        .mount("/", FileServer::from(relative!("/static")))
}
