let lastScrollTop = 0;
let initAboutWrapHeight = 0;

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
      navBar.css({ top: "-62px" });
    } else {
      // upscroll code
      navBar.css({ top: "0px" });
    }
    lastScrollTop = st;
  });

  // Handle height for about wrap in about section
  const $aboutWrap = $("#about-wrap");
  initAboutWrapHeight = $aboutWrap.height();
  adjustAboutWrapHeight();

  // Ensure profile picture is loaded before adjusting size
  const $profilePic = $("#profile-picture");
  if ($profilePic.length && !$profilePic[0].complete) {
    $profilePic.on("load", adjustAboutPictureSize);
  } else {
    adjustAboutPictureSize();
  }

  $(window).on("resize", adjustAboutWrapHeight);
  $(window).on("resize", adjustAboutPictureSize);
});

function adjustAboutWrapHeight() {
  const $aboutWrap = $("#about-wrap");
  const $textBox = $(".left-half .text-box");

  // Section height
  if ($textBox.length && $aboutWrap.length) {
    const textBoxHeight = $textBox.outerHeight();
    const aboutWrapHeight = $aboutWrap.height();
    if (textBoxHeight > aboutWrapHeight) {
      $aboutWrap.height(textBoxHeight + 20); // 20px extra for spacing
    } else if (textBoxHeight + 20 < aboutWrapHeight) {
      // Restore init height
      $aboutWrap.height(initAboutWrapHeight);
    }
  }
}

function adjustAboutPictureSize() {
  const $aboutWrap = $("#about-wrap");
  const $profilePic = $("#profile-picture");

  // Profile picture size
  if ($profilePic.length && $aboutWrap.length) {
    const aboutWrapWidth = $aboutWrap.width();
    const halfWidth = aboutWrapWidth / 2;

    // Get original aspect ratio
    const picWidth = $profilePic.width();
    const picHeight = $profilePic.height();
    const aspectRatio = picWidth / picHeight;

    if (aboutWrapWidth <= 768) {
      // Set width to half of about-wrap, adjust height to keep aspect ratio
      $profilePic.css({
        width: halfWidth,
        height: halfWidth / aspectRatio
      });
    } else {
      // Set height to 100%
      $profilePic.css({
        height: "100%",
        width: ""
      });
    }
  }
}

