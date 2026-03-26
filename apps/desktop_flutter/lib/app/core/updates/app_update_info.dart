class AppUpdateInfo {
  const AppUpdateInfo({
    required this.version,
    required this.name,
    required this.htmlUrl,
    required this.downloadUrl,
    required this.publishedAt,
    required this.prerelease,
    this.notes,
  });

  final String version;
  final String name;
  final String htmlUrl;
  final String downloadUrl;
  final DateTime publishedAt;
  final bool prerelease;
  final String? notes;
}
