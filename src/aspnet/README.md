# ASP.NET integration

1. Copy `Stairs2lineArchiveFileValidator.cs` and `Stairs2lineArchiveExtensions.cs` into the ASP.NET project.
2. Register `AddStairs2lineArchive()` and map `MapStairs2lineArchiveValidation()`.
3. Build the static archive directly into `wwwroot` or copy the generated output there.
4. The generated pages call the validation endpoint when it exists. On GitHub Pages the request is ignored.
5. A server-rendered Razor page can include `_ArchiveValidationAlert.cshtml` instead of the client-side banner.

The validator caches its result for the lifetime of the application and does not scan the media directory on every request.
