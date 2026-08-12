using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Logging;

namespace Stairs2line.Archive;

public sealed record ArchiveValidationResult(
    IReadOnlyList<string> MissingOnDisk,
    IReadOnlyList<string> UnlistedOnDisk)
{
    public bool IsValid => MissingOnDisk.Count == 0 && UnlistedOnDisk.Count == 0;
}

public sealed class Stairs2lineArchiveFileValidator
{
    private static readonly string[] MediaDirectories = { "twitter", "tumblr", "pixiv", "other" };

    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<Stairs2lineArchiveFileValidator> _logger;
    private readonly Lazy<ArchiveValidationResult> _cachedResult;

    public Stairs2lineArchiveFileValidator(
        IWebHostEnvironment environment,
        ILogger<Stairs2lineArchiveFileValidator> logger)
    {
        _environment = environment;
        _logger = logger;
        _cachedResult = new Lazy<ArchiveValidationResult>(ValidateCore, LazyThreadSafetyMode.ExecutionAndPublication);
    }

    public ArchiveValidationResult Validate() => _cachedResult.Value;

    private ArchiveValidationResult ValidateCore()
    {
        var mediaRoot = Path.Combine(_environment.WebRootPath, "media", "stairs2line");
        var manifestPath = Path.Combine(_environment.WebRootPath, "data", "manifest.json");

        if (!File.Exists(manifestPath))
        {
            _logger.LogError("The stairs2line archive manifest was not found at {ManifestPath}.", manifestPath);
            return new ArchiveValidationResult(new[] { "data/manifest.json" }, Array.Empty<string>());
        }

        using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
        var mediaNode = document.RootElement.GetProperty("media");
        var declaredFiles = mediaNode.EnumerateObject()
            .SelectMany(property => property.Value.GetProperty("existingFiles").EnumerateArray())
            .Select(element => Normalize(element.GetString() ?? string.Empty))
            .Where(filePath => filePath.Length > 0 && !filePath.StartsWith("assets/placeholders/", StringComparison.Ordinal))
            .ToHashSet(StringComparer.Ordinal);

        var diskFiles = MediaDirectories
            .SelectMany(directoryName => EnumerateDirectory(mediaRoot, directoryName))
            .Select(path => Normalize(Path.GetRelativePath(mediaRoot, path)))
            .ToHashSet(StringComparer.Ordinal);

        var missingOnDisk = declaredFiles
            .Except(diskFiles, StringComparer.Ordinal)
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToArray();

        var unlistedOnDisk = diskFiles
            .Except(declaredFiles, StringComparer.Ordinal)
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToArray();

        if (missingOnDisk.Length > 0 || unlistedOnDisk.Length > 0)
        {
            _logger.LogWarning(
                "The stairs2line archive is out of sync. Missing on disk: {MissingCount}; unlisted on disk: {UnlistedCount}.",
                missingOnDisk.Length,
                unlistedOnDisk.Length);
        }

        return new ArchiveValidationResult(missingOnDisk, unlistedOnDisk);
    }

    private static IEnumerable<string> EnumerateDirectory(string mediaRoot, string directoryName)
    {
        var directory = Path.Combine(mediaRoot, directoryName);
        return Directory.Exists(directory)
            ? Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories)
            : Enumerable.Empty<string>();
    }

    private static string Normalize(string value) => value.Replace('\\', '/').TrimStart('/');
}
