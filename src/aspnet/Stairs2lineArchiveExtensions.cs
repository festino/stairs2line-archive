using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Stairs2line.Archive;

public static class Stairs2lineArchiveExtensions
{
    public static IServiceCollection AddStairs2lineArchive(this IServiceCollection services)
    {
        services.AddSingleton<Stairs2lineArchiveFileValidator>();
        return services;
    }

    public static IEndpointRouteBuilder MapStairs2lineArchiveValidation(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/stairs2line/archive-validation", (
            Stairs2lineArchiveFileValidator validator) => Results.Ok(validator.Validate()));
        return endpoints;
    }
}
