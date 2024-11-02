use rocket::{
    fs::{relative, FileServer},
    get, launch, routes,
};
use rocket_dyn_templates::{context, Template};

#[get("/")]
async fn index() -> Template {
    Template::render("index", context! {})
}

#[launch]
fn rocket() -> _ {
    rocket::build()
        .mount("/", routes![index])
        .attach(Template::fairing())
        .mount("/", FileServer::from(relative!("/static")))
}
