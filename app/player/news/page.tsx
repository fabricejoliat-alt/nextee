import ClubNewsFeed from "@/components/news/ClubNewsFeed";

export default function PlayerNewsPage() {
  return (
    <ClubNewsFeed
      scope="player"
      homeHref="/player"
      titleFr="News"
      titleEn="News"
      titleDe="News"
      titleIt="News"
    />
  );
}
