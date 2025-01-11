let lastScrollTop = 0;

jQuery(document).ready(function ($) {
  // Smooth Scrolling
  $(".smoothscroll").on("click", function (e) {
    e.preventDefault();

    var target = this.hash,
      $target = $(target);

    $("html, body")
      .stop()
      .animate(
        {
          scrollTop: $target.offset().top,
        },
        800,
        "swing",
        function () {
          window.location.hash = target;
        }
      );
  });

  // Responsive resizing of header
  $("header").css({ height: $(window).height() });
  $(window).on("resize", function () {
    $("header").css({ height: $(window).height() });
    $("body").css({ width: $(window).width() });
  });

  // Hide nav on scroll
  $(window).scroll(function (event) {
    let st = $(this).scrollTop();
    let navBar = $("#nav-wrap");
    if (st > lastScrollTop) {
      // downscroll code
      navBar.css({ top: "-50px" });
    } else {
      // upscroll code
      navBar.css({ top: "0px" });
    }
    lastScrollTop = st;
  });
});
