package com.quizradar.app.ui.icons

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * A local copy of the Material icons this app draws.
 *
 * The path data was transpiled from the `material-icons-extended` /
 * `material-icons-core` bytecode, so every glyph is byte-for-byte the same
 * as the Material one - same viewport, same path commands, same fill.
 * Keeping the vectors in-tree drops the 10 MB icon artifact from the
 * dependency graph.
 *
 * The API shape mirrors `androidx.compose.material.icons.Icons`, so the
 * call sites (`Icons.Outlined.Dashboard`, `Icons.Filled.Place`,
 * `Icons.AutoMirrored.Filled.ArrowBack`) did not have to change.
 */
object Icons {
    /** `Icons.Default` is an alias of `Icons.Filled` in the Material API. */
    val Default: Filled = Filled

    object Filled {
        /** `Filled.CalendarMonth` */
        val CalendarMonth: ImageVector =
            materialIcon(
                name = "Filled.CalendarMonth",
                drawPaths =
                    listOf(
                        {
                            moveTo(19f, 4f)
                            horizontalLineToRelative(-1f)
                            verticalLineTo(2f)
                            horizontalLineToRelative(-2f)
                            verticalLineToRelative(2f)
                            horizontalLineTo(8f)
                            verticalLineTo(2f)
                            horizontalLineTo(6f)
                            verticalLineToRelative(2f)
                            horizontalLineTo(5f)
                            curveTo(3.89f, 4f, 3.01f, 4.9f, 3.01f, 6f)
                            lineTo(3f, 20f)
                            curveToRelative(0f, 1.1f, 0.89f, 2f, 2f, 2f)
                            horizontalLineToRelative(14f)
                            curveToRelative(1.1f, 0f, 2f, -0.9f, 2f, -2f)
                            verticalLineTo(6f)
                            curveTo(21f, 4.9f, 20.1f, 4f, 19f, 4f)
                            close()
                            moveTo(19f, 20f)
                            horizontalLineTo(5f)
                            verticalLineTo(10f)
                            horizontalLineToRelative(14f)
                            verticalLineTo(20f)
                            close()
                            moveTo(9f, 14f)
                            horizontalLineTo(7f)
                            verticalLineToRelative(-2f)
                            horizontalLineToRelative(2f)
                            verticalLineTo(14f)
                            close()
                            moveTo(13f, 14f)
                            horizontalLineToRelative(-2f)
                            verticalLineToRelative(-2f)
                            horizontalLineToRelative(2f)
                            verticalLineTo(14f)
                            close()
                            moveTo(17f, 14f)
                            horizontalLineToRelative(-2f)
                            verticalLineToRelative(-2f)
                            horizontalLineToRelative(2f)
                            verticalLineTo(14f)
                            close()
                            moveTo(9f, 18f)
                            horizontalLineTo(7f)
                            verticalLineToRelative(-2f)
                            horizontalLineToRelative(2f)
                            verticalLineTo(18f)
                            close()
                            moveTo(13f, 18f)
                            horizontalLineToRelative(-2f)
                            verticalLineToRelative(-2f)
                            horizontalLineToRelative(2f)
                            verticalLineTo(18f)
                            close()
                            moveTo(17f, 18f)
                            horizontalLineToRelative(-2f)
                            verticalLineToRelative(-2f)
                            horizontalLineToRelative(2f)
                            verticalLineTo(18f)
                            close()
                        },
                    ),
            )

        /** `Filled.Close` */
        val Close: ImageVector =
            materialIcon(
                name = "Filled.Close",
                drawPaths =
                    listOf(
                        {
                            moveTo(19f, 6.41f)
                            lineTo(17.59f, 5f)
                            lineTo(12f, 10.59f)
                            lineTo(6.41f, 5f)
                            lineTo(5f, 6.41f)
                            lineTo(10.59f, 12f)
                            lineTo(5f, 17.59f)
                            lineTo(6.41f, 19f)
                            lineTo(12f, 13.41f)
                            lineTo(17.59f, 19f)
                            lineTo(19f, 17.59f)
                            lineTo(13.41f, 12f)
                            close()
                        },
                    ),
            )

        /** `Filled.Place` */
        val Place: ImageVector =
            materialIcon(
                name = "Filled.Place",
                drawPaths =
                    listOf(
                        {
                            moveTo(12f, 2f)
                            curveTo(8.13f, 2f, 5f, 5.13f, 5f, 9f)
                            curveToRelative(0f, 5.25f, 7f, 13f, 7f, 13f)
                            reflectiveCurveToRelative(7f, -7.75f, 7f, -13f)
                            curveToRelative(0f, -3.87f, -3.13f, -7f, -7f, -7f)
                            close()
                            moveTo(12f, 11.5f)
                            curveToRelative(-1.38f, 0f, -2.5f, -1.12f, -2.5f, -2.5f)
                            reflectiveCurveToRelative(1.12f, -2.5f, 2.5f, -2.5f)
                            reflectiveCurveToRelative(2.5f, 1.12f, 2.5f, 2.5f)
                            reflectiveCurveToRelative(-1.12f, 2.5f, -2.5f, 2.5f)
                            close()
                        },
                    ),
            )

        /** `Filled.SquareFoot` */
        val SquareFoot: ImageVector =
            materialIcon(
                name = "Filled.SquareFoot",
                drawPaths =
                    listOf(
                        {
                            moveTo(17.66f, 17.66f)
                            lineToRelative(-1.06f, 1.06f)
                            lineToRelative(-0.71f, -0.71f)
                            lineToRelative(1.06f, -1.06f)
                            lineToRelative(-1.94f, -1.94f)
                            lineToRelative(-1.06f, 1.06f)
                            lineToRelative(-0.71f, -0.71f)
                            lineToRelative(1.06f, -1.06f)
                            lineToRelative(-1.94f, -1.94f)
                            lineToRelative(-1.06f, 1.06f)
                            lineToRelative(-0.71f, -0.71f)
                            lineToRelative(1.06f, -1.06f)
                            lineTo(9.7f, 9.7f)
                            lineToRelative(-1.06f, 1.06f)
                            lineToRelative(-0.71f, -0.71f)
                            lineToRelative(1.06f, -1.06f)
                            lineTo(7.05f, 7.05f)
                            lineTo(5.99f, 8.11f)
                            lineTo(5.28f, 7.4f)
                            lineToRelative(1.06f, -1.06f)
                            lineTo(4f, 4f)
                            verticalLineToRelative(14f)
                            curveToRelative(0f, 1.1f, 0.9f, 2f, 2f, 2f)
                            horizontalLineToRelative(14f)
                            lineTo(17.66f, 17.66f)
                            close()
                            moveTo(7f, 17f)
                            verticalLineToRelative(-5.76f)
                            lineTo(12.76f, 17f)
                            horizontalLineTo(7f)
                            close()
                        },
                    ),
            )

        /** `Filled.Visibility` */
        val Visibility: ImageVector =
            materialIcon(
                name = "Filled.Visibility",
                drawPaths =
                    listOf(
                        {
                            moveTo(12f, 4.5f)
                            curveTo(7f, 4.5f, 2.73f, 7.61f, 1f, 12f)
                            curveToRelative(1.73f, 4.39f, 6f, 7.5f, 11f, 7.5f)
                            reflectiveCurveToRelative(9.27f, -3.11f, 11f, -7.5f)
                            curveToRelative(-1.73f, -4.39f, -6f, -7.5f, -11f, -7.5f)
                            close()
                            moveTo(12f, 17f)
                            curveToRelative(-2.76f, 0f, -5f, -2.24f, -5f, -5f)
                            reflectiveCurveToRelative(2.24f, -5f, 5f, -5f)
                            reflectiveCurveToRelative(5f, 2.24f, 5f, 5f)
                            reflectiveCurveToRelative(-2.24f, 5f, -5f, 5f)
                            close()
                            moveTo(12f, 9f)
                            curveToRelative(-1.66f, 0f, -3f, 1.34f, -3f, 3f)
                            reflectiveCurveToRelative(1.34f, 3f, 3f, 3f)
                            reflectiveCurveToRelative(3f, -1.34f, 3f, -3f)
                            reflectiveCurveToRelative(-1.34f, -3f, -3f, -3f)
                            close()
                        },
                    ),
            )

        /** `Filled.VisibilityOff` */
        val VisibilityOff: ImageVector =
            materialIcon(
                name = "Filled.VisibilityOff",
                drawPaths =
                    listOf(
                        {
                            moveTo(12f, 7f)
                            curveToRelative(2.76f, 0f, 5f, 2.24f, 5f, 5f)
                            curveToRelative(0f, 0.65f, -0.13f, 1.26f, -0.36f, 1.83f)
                            lineToRelative(2.92f, 2.92f)
                            curveToRelative(1.51f, -1.26f, 2.7f, -2.89f, 3.43f, -4.75f)
                            curveToRelative(-1.73f, -4.39f, -6f, -7.5f, -11f, -7.5f)
                            curveToRelative(-1.4f, 0f, -2.74f, 0.25f, -3.98f, 0.7f)
                            lineToRelative(2.16f, 2.16f)
                            curveTo(10.74f, 7.13f, 11.35f, 7f, 12f, 7f)
                            close()
                            moveTo(2f, 4.27f)
                            lineToRelative(2.28f, 2.28f)
                            lineToRelative(0.46f, 0.46f)
                            curveTo(3.08f, 8.3f, 1.78f, 10.02f, 1f, 12f)
                            curveToRelative(1.73f, 4.39f, 6f, 7.5f, 11f, 7.5f)
                            curveToRelative(1.55f, 0f, 3.03f, -0.3f, 4.38f, -0.84f)
                            lineToRelative(0.42f, 0.42f)
                            lineTo(19.73f, 22f)
                            lineTo(21f, 20.73f)
                            lineTo(3.27f, 3f)
                            lineTo(2f, 4.27f)
                            close()
                            moveTo(7.53f, 9.8f)
                            lineToRelative(1.55f, 1.55f)
                            curveToRelative(-0.05f, 0.21f, -0.08f, 0.43f, -0.08f, 0.65f)
                            curveToRelative(0f, 1.66f, 1.34f, 3f, 3f, 3f)
                            curveToRelative(0.22f, 0f, 0.44f, -0.03f, 0.65f, -0.08f)
                            lineToRelative(1.55f, 1.55f)
                            curveToRelative(-0.67f, 0.33f, -1.41f, 0.53f, -2.2f, 0.53f)
                            curveToRelative(-2.76f, 0f, -5f, -2.24f, -5f, -5f)
                            curveToRelative(0f, -0.79f, 0.2f, -1.53f, 0.53f, -2.2f)
                            close()
                            moveTo(11.84f, 9.02f)
                            lineToRelative(3.15f, 3.15f)
                            lineToRelative(0.02f, -0.16f)
                            curveToRelative(0f, -1.66f, -1.34f, -3f, -3f, -3f)
                            lineToRelative(-0.17f, 0.01f)
                            close()
                        },
                    ),
            )
    }

    object Outlined {
        /** `Outlined.AccountCircle` */
        val AccountCircle: ImageVector =
            materialIcon(
                name = "Outlined.AccountCircle",
                drawPaths =
                    listOf(
                        {
                            moveTo(12f, 2f)
                            curveTo(6.48f, 2f, 2f, 6.48f, 2f, 12f)
                            reflectiveCurveToRelative(4.48f, 10f, 10f, 10f)
                            reflectiveCurveToRelative(10f, -4.48f, 10f, -10f)
                            reflectiveCurveTo(17.52f, 2f, 12f, 2f)
                            close()
                            moveTo(7.35f, 18.5f)
                            curveTo(8.66f, 17.56f, 10.26f, 17f, 12f, 17f)
                            reflectiveCurveToRelative(3.34f, 0.56f, 4.65f, 1.5f)
                            curveTo(15.34f, 19.44f, 13.74f, 20f, 12f, 20f)
                            reflectiveCurveTo(8.66f, 19.44f, 7.35f, 18.5f)
                            close()
                            moveTo(18.14f, 17.12f)
                            lineTo(18.14f, 17.12f)
                            curveTo(16.45f, 15.8f, 14.32f, 15f, 12f, 15f)
                            reflectiveCurveToRelative(-4.45f, 0.8f, -6.14f, 2.12f)
                            lineToRelative(0f, 0f)
                            curveTo(4.7f, 15.73f, 4f, 13.95f, 4f, 12f)
                            curveToRelative(0f, -4.42f, 3.58f, -8f, 8f, -8f)
                            reflectiveCurveToRelative(8f, 3.58f, 8f, 8f)
                            curveTo(20f, 13.95f, 19.3f, 15.73f, 18.14f, 17.12f)
                            close()
                        },
                        {
                            moveTo(12f, 6f)
                            curveToRelative(-1.93f, 0f, -3.5f, 1.57f, -3.5f, 3.5f)
                            reflectiveCurveTo(10.07f, 13f, 12f, 13f)
                            reflectiveCurveToRelative(3.5f, -1.57f, 3.5f, -3.5f)
                            reflectiveCurveTo(13.93f, 6f, 12f, 6f)
                            close()
                            moveTo(12f, 11f)
                            curveToRelative(-0.83f, 0f, -1.5f, -0.67f, -1.5f, -1.5f)
                            reflectiveCurveTo(11.17f, 8f, 12f, 8f)
                            reflectiveCurveToRelative(1.5f, 0.67f, 1.5f, 1.5f)
                            reflectiveCurveTo(12.83f, 11f, 12f, 11f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Add` */
        val Add: ImageVector =
            materialIcon(
                name = "Outlined.Add",
                drawPaths =
                    listOf(
                        {
                            moveTo(19f, 13f)
                            horizontalLineToRelative(-6f)
                            verticalLineToRelative(6f)
                            horizontalLineToRelative(-2f)
                            verticalLineToRelative(-6f)
                            horizontalLineTo(5f)
                            verticalLineToRelative(-2f)
                            horizontalLineToRelative(6f)
                            verticalLineTo(5f)
                            horizontalLineToRelative(2f)
                            verticalLineToRelative(6f)
                            horizontalLineToRelative(6f)
                            verticalLineToRelative(2f)
                            close()
                        },
                    ),
            )

        /** `Outlined.AutoAwesome` */
        val AutoAwesome: ImageVector =
            materialIcon(
                name = "Outlined.AutoAwesome",
                drawPaths =
                    listOf(
                        {
                            moveTo(19f, 9f)
                            lineToRelative(1.25f, -2.75f)
                            lineToRelative(2.75f, -1.25f)
                            lineToRelative(-2.75f, -1.25f)
                            lineToRelative(-1.25f, -2.75f)
                            lineToRelative(-1.25f, 2.75f)
                            lineToRelative(-2.75f, 1.25f)
                            lineToRelative(2.75f, 1.25f)
                            close()
                        },
                        {
                            moveTo(19f, 15f)
                            lineToRelative(-1.25f, 2.75f)
                            lineToRelative(-2.75f, 1.25f)
                            lineToRelative(2.75f, 1.25f)
                            lineToRelative(1.25f, 2.75f)
                            lineToRelative(1.25f, -2.75f)
                            lineToRelative(2.75f, -1.25f)
                            lineToRelative(-2.75f, -1.25f)
                            close()
                        },
                        {
                            moveTo(11.5f, 9.5f)
                            lineTo(9f, 4f)
                            lineTo(6.5f, 9.5f)
                            lineTo(1f, 12f)
                            lineToRelative(5.5f, 2.5f)
                            lineTo(9f, 20f)
                            lineToRelative(2.5f, -5.5f)
                            lineTo(17f, 12f)
                            lineTo(11.5f, 9.5f)
                            close()
                            moveTo(9.99f, 12.99f)
                            lineTo(9f, 15.17f)
                            lineToRelative(-0.99f, -2.18f)
                            lineTo(5.83f, 12f)
                            lineToRelative(2.18f, -0.99f)
                            lineTo(9f, 8.83f)
                            lineToRelative(0.99f, 2.18f)
                            lineTo(12.17f, 12f)
                            lineTo(9.99f, 12.99f)
                            close()
                        },
                    ),
            )

        /** `Outlined.CalendarMonth` */
        val CalendarMonth: ImageVector =
            materialIcon(
                name = "Outlined.CalendarMonth",
                drawPaths =
                    listOf(
                        {
                            moveTo(19f, 4f)
                            horizontalLineToRelative(-1f)
                            verticalLineTo(2f)
                            horizontalLineToRelative(-2f)
                            verticalLineToRelative(2f)
                            horizontalLineTo(8f)
                            verticalLineTo(2f)
                            horizontalLineTo(6f)
                            verticalLineToRelative(2f)
                            horizontalLineTo(5f)
                            curveTo(3.89f, 4f, 3.01f, 4.9f, 3.01f, 6f)
                            lineTo(3f, 20f)
                            curveToRelative(0f, 1.1f, 0.89f, 2f, 2f, 2f)
                            horizontalLineToRelative(14f)
                            curveToRelative(1.1f, 0f, 2f, -0.9f, 2f, -2f)
                            verticalLineTo(6f)
                            curveTo(21f, 4.9f, 20.1f, 4f, 19f, 4f)
                            close()
                            moveTo(19f, 20f)
                            horizontalLineTo(5f)
                            verticalLineTo(10f)
                            horizontalLineToRelative(14f)
                            verticalLineTo(20f)
                            close()
                            moveTo(19f, 8f)
                            horizontalLineTo(5f)
                            verticalLineTo(6f)
                            horizontalLineToRelative(14f)
                            verticalLineTo(8f)
                            close()
                            moveTo(9f, 14f)
                            horizontalLineTo(7f)
                            verticalLineToRelative(-2f)
                            horizontalLineToRelative(2f)
                            verticalLineTo(14f)
                            close()
                            moveTo(13f, 14f)
                            horizontalLineToRelative(-2f)
                            verticalLineToRelative(-2f)
                            horizontalLineToRelative(2f)
                            verticalLineTo(14f)
                            close()
                            moveTo(17f, 14f)
                            horizontalLineToRelative(-2f)
                            verticalLineToRelative(-2f)
                            horizontalLineToRelative(2f)
                            verticalLineTo(14f)
                            close()
                            moveTo(9f, 18f)
                            horizontalLineTo(7f)
                            verticalLineToRelative(-2f)
                            horizontalLineToRelative(2f)
                            verticalLineTo(18f)
                            close()
                            moveTo(13f, 18f)
                            horizontalLineToRelative(-2f)
                            verticalLineToRelative(-2f)
                            horizontalLineToRelative(2f)
                            verticalLineTo(18f)
                            close()
                            moveTo(17f, 18f)
                            horizontalLineToRelative(-2f)
                            verticalLineToRelative(-2f)
                            horizontalLineToRelative(2f)
                            verticalLineTo(18f)
                            close()
                        },
                    ),
            )

        /** `Outlined.CalendarToday` */
        val CalendarToday: ImageVector =
            materialIcon(
                name = "Outlined.CalendarToday",
                drawPaths =
                    listOf(
                        {
                            moveTo(20f, 3f)
                            horizontalLineToRelative(-1f)
                            lineTo(19f, 1f)
                            horizontalLineToRelative(-2f)
                            verticalLineToRelative(2f)
                            lineTo(7f, 3f)
                            lineTo(7f, 1f)
                            lineTo(5f, 1f)
                            verticalLineToRelative(2f)
                            lineTo(4f, 3f)
                            curveToRelative(-1.1f, 0f, -2f, 0.9f, -2f, 2f)
                            verticalLineToRelative(16f)
                            curveToRelative(0f, 1.1f, 0.9f, 2f, 2f, 2f)
                            horizontalLineToRelative(16f)
                            curveToRelative(1.1f, 0f, 2f, -0.9f, 2f, -2f)
                            lineTo(22f, 5f)
                            curveToRelative(0f, -1.1f, -0.9f, -2f, -2f, -2f)
                            close()
                            moveTo(20f, 21f)
                            lineTo(4f, 21f)
                            lineTo(4f, 10f)
                            horizontalLineToRelative(16f)
                            verticalLineToRelative(11f)
                            close()
                            moveTo(20f, 8f)
                            lineTo(4f, 8f)
                            lineTo(4f, 5f)
                            horizontalLineToRelative(16f)
                            verticalLineToRelative(3f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Check` */
        val Check: ImageVector =
            materialIcon(
                name = "Outlined.Check",
                drawPaths =
                    listOf(
                        {
                            moveTo(9f, 16.17f)
                            lineTo(4.83f, 12f)
                            lineToRelative(-1.42f, 1.41f)
                            lineTo(9f, 19f)
                            lineTo(21f, 7f)
                            lineToRelative(-1.41f, -1.41f)
                            lineTo(9f, 16.17f)
                            close()
                        },
                    ),
            )

        /** `Outlined.CheckCircle` */
        val CheckCircle: ImageVector =
            materialIcon(
                name = "Outlined.CheckCircle",
                drawPaths =
                    listOf(
                        {
                            moveTo(12f, 2f)
                            curveTo(6.48f, 2f, 2f, 6.48f, 2f, 12f)
                            reflectiveCurveToRelative(4.48f, 10f, 10f, 10f)
                            reflectiveCurveToRelative(10f, -4.48f, 10f, -10f)
                            reflectiveCurveTo(17.52f, 2f, 12f, 2f)
                            close()
                            moveTo(12f, 20f)
                            curveToRelative(-4.41f, 0f, -8f, -3.59f, -8f, -8f)
                            reflectiveCurveToRelative(3.59f, -8f, 8f, -8f)
                            reflectiveCurveToRelative(8f, 3.59f, 8f, 8f)
                            reflectiveCurveToRelative(-3.59f, 8f, -8f, 8f)
                            close()
                            moveTo(16.59f, 7.58f)
                            lineTo(10f, 14.17f)
                            lineToRelative(-2.59f, -2.58f)
                            lineTo(6f, 13f)
                            lineToRelative(4f, 4f)
                            lineToRelative(8f, -8f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Checklist` */
        val Checklist: ImageVector =
            materialIcon(
                name = "Outlined.Checklist",
                drawPaths =
                    listOf(
                        {
                            moveTo(22f, 7f)
                            horizontalLineToRelative(-9f)
                            verticalLineToRelative(2f)
                            horizontalLineToRelative(9f)
                            verticalLineTo(7f)
                            close()
                            moveTo(22f, 15f)
                            horizontalLineToRelative(-9f)
                            verticalLineToRelative(2f)
                            horizontalLineToRelative(9f)
                            verticalLineTo(15f)
                            close()
                            moveTo(5.54f, 11f)
                            lineTo(2f, 7.46f)
                            lineToRelative(1.41f, -1.41f)
                            lineToRelative(2.12f, 2.12f)
                            lineToRelative(4.24f, -4.24f)
                            lineToRelative(1.41f, 1.41f)
                            lineTo(5.54f, 11f)
                            close()
                            moveTo(5.54f, 19f)
                            lineTo(2f, 15.46f)
                            lineToRelative(1.41f, -1.41f)
                            lineToRelative(2.12f, 2.12f)
                            lineToRelative(4.24f, -4.24f)
                            lineToRelative(1.41f, 1.41f)
                            lineTo(5.54f, 19f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Close` */
        val Close: ImageVector =
            materialIcon(
                name = "Outlined.Close",
                drawPaths =
                    listOf(
                        {
                            moveTo(19f, 6.41f)
                            lineTo(17.59f, 5f)
                            lineTo(12f, 10.59f)
                            lineTo(6.41f, 5f)
                            lineTo(5f, 6.41f)
                            lineTo(10.59f, 12f)
                            lineTo(5f, 17.59f)
                            lineTo(6.41f, 19f)
                            lineTo(12f, 13.41f)
                            lineTo(17.59f, 19f)
                            lineTo(19f, 17.59f)
                            lineTo(13.41f, 12f)
                            lineTo(19f, 6.41f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Dashboard` */
        val Dashboard: ImageVector =
            materialIcon(
                name = "Outlined.Dashboard",
                drawPaths =
                    listOf(
                        {
                            moveTo(19f, 5f)
                            verticalLineToRelative(2f)
                            horizontalLineToRelative(-4f)
                            lineTo(15f, 5f)
                            horizontalLineToRelative(4f)
                            moveTo(9f, 5f)
                            verticalLineToRelative(6f)
                            lineTo(5f, 11f)
                            lineTo(5f, 5f)
                            horizontalLineToRelative(4f)
                            moveToRelative(10f, 8f)
                            verticalLineToRelative(6f)
                            horizontalLineToRelative(-4f)
                            verticalLineToRelative(-6f)
                            horizontalLineToRelative(4f)
                            moveTo(9f, 17f)
                            verticalLineToRelative(2f)
                            lineTo(5f, 19f)
                            verticalLineToRelative(-2f)
                            horizontalLineToRelative(4f)
                            moveTo(21f, 3f)
                            horizontalLineToRelative(-8f)
                            verticalLineToRelative(6f)
                            horizontalLineToRelative(8f)
                            lineTo(21f, 3f)
                            close()
                            moveTo(11f, 3f)
                            lineTo(3f, 3f)
                            verticalLineToRelative(10f)
                            horizontalLineToRelative(8f)
                            lineTo(11f, 3f)
                            close()
                            moveTo(21f, 11f)
                            horizontalLineToRelative(-8f)
                            verticalLineToRelative(10f)
                            horizontalLineToRelative(8f)
                            lineTo(21f, 11f)
                            close()
                            moveTo(11f, 15f)
                            lineTo(3f, 15f)
                            verticalLineToRelative(6f)
                            horizontalLineToRelative(8f)
                            verticalLineToRelative(-6f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Delete` */
        val Delete: ImageVector =
            materialIcon(
                name = "Outlined.Delete",
                drawPaths =
                    listOf(
                        {
                            moveTo(16f, 9f)
                            verticalLineToRelative(10f)
                            horizontalLineTo(8f)
                            verticalLineTo(9f)
                            horizontalLineToRelative(8f)
                            moveToRelative(-1.5f, -6f)
                            horizontalLineToRelative(-5f)
                            lineToRelative(-1f, 1f)
                            horizontalLineTo(5f)
                            verticalLineToRelative(2f)
                            horizontalLineToRelative(14f)
                            verticalLineTo(4f)
                            horizontalLineToRelative(-3.5f)
                            lineToRelative(-1f, -1f)
                            close()
                            moveTo(18f, 7f)
                            horizontalLineTo(6f)
                            verticalLineToRelative(12f)
                            curveToRelative(0f, 1.1f, 0.9f, 2f, 2f, 2f)
                            horizontalLineToRelative(8f)
                            curveToRelative(1.1f, 0f, 2f, -0.9f, 2f, -2f)
                            verticalLineTo(7f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Download` */
        val Download: ImageVector =
            materialIcon(
                name = "Outlined.Download",
                drawPaths =
                    listOf(
                        {
                            moveTo(19f, 9f)
                            horizontalLineToRelative(-4f)
                            lineTo(15f, 3f)
                            lineTo(9f, 3f)
                            verticalLineToRelative(6f)
                            lineTo(5f, 9f)
                            lineToRelative(7f, 7f)
                            lineToRelative(7f, -7f)
                            close()
                            moveTo(11f, 11f)
                            lineTo(11f, 5f)
                            horizontalLineToRelative(2f)
                            verticalLineToRelative(6f)
                            horizontalLineToRelative(1.17f)
                            lineTo(12f, 13.17f)
                            lineTo(9.83f, 11f)
                            lineTo(11f, 11f)
                            close()
                            moveTo(5f, 18f)
                            horizontalLineToRelative(14f)
                            verticalLineToRelative(2f)
                            lineTo(5f, 20f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Email` */
        val Email: ImageVector =
            materialIcon(
                name = "Outlined.Email",
                drawPaths =
                    listOf(
                        {
                            moveTo(22f, 6f)
                            curveToRelative(0f, -1.1f, -0.9f, -2f, -2f, -2f)
                            lineTo(4f, 4f)
                            curveToRelative(-1.1f, 0f, -2f, 0.9f, -2f, 2f)
                            verticalLineToRelative(12f)
                            curveToRelative(0f, 1.1f, 0.9f, 2f, 2f, 2f)
                            horizontalLineToRelative(16f)
                            curveToRelative(1.1f, 0f, 2f, -0.9f, 2f, -2f)
                            lineTo(22f, 6f)
                            close()
                            moveTo(20f, 6f)
                            lineToRelative(-8f, 5f)
                            lineToRelative(-8f, -5f)
                            horizontalLineToRelative(16f)
                            close()
                            moveTo(20f, 18f)
                            lineTo(4f, 18f)
                            lineTo(4f, 8f)
                            lineToRelative(8f, 5f)
                            lineToRelative(8f, -5f)
                            verticalLineToRelative(10f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Event` */
        val Event: ImageVector =
            materialIcon(
                name = "Outlined.Event",
                drawPaths =
                    listOf(
                        {
                            moveTo(19f, 4f)
                            horizontalLineToRelative(-1f)
                            lineTo(18f, 2f)
                            horizontalLineToRelative(-2f)
                            verticalLineToRelative(2f)
                            lineTo(8f, 4f)
                            lineTo(8f, 2f)
                            lineTo(6f, 2f)
                            verticalLineToRelative(2f)
                            lineTo(5f, 4f)
                            curveToRelative(-1.11f, 0f, -1.99f, 0.9f, -1.99f, 2f)
                            lineTo(3f, 20f)
                            curveToRelative(0f, 1.1f, 0.89f, 2f, 2f, 2f)
                            horizontalLineToRelative(14f)
                            curveToRelative(1.1f, 0f, 2f, -0.9f, 2f, -2f)
                            lineTo(21f, 6f)
                            curveToRelative(0f, -1.1f, -0.9f, -2f, -2f, -2f)
                            close()
                            moveTo(19f, 20f)
                            lineTo(5f, 20f)
                            lineTo(5f, 10f)
                            horizontalLineToRelative(14f)
                            verticalLineToRelative(10f)
                            close()
                            moveTo(19f, 8f)
                            lineTo(5f, 8f)
                            lineTo(5f, 6f)
                            horizontalLineToRelative(14f)
                            verticalLineToRelative(2f)
                            close()
                            moveTo(12f, 13f)
                            horizontalLineToRelative(5f)
                            verticalLineToRelative(5f)
                            horizontalLineToRelative(-5f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Groups` */
        val Groups: ImageVector =
            materialIcon(
                name = "Outlined.Groups",
                drawPaths =
                    listOf(
                        {
                            moveTo(4f, 13f)
                            curveToRelative(1.1f, 0f, 2f, -0.9f, 2f, -2f)
                            curveToRelative(0f, -1.1f, -0.9f, -2f, -2f, -2f)
                            reflectiveCurveToRelative(-2f, 0.9f, -2f, 2f)
                            curveTo(2f, 12.1f, 2.9f, 13f, 4f, 13f)
                            close()
                            moveTo(5.13f, 14.1f)
                            curveTo(4.76f, 14.04f, 4.39f, 14f, 4f, 14f)
                            curveToRelative(-0.99f, 0f, -1.93f, 0.21f, -2.78f, 0.58f)
                            curveTo(0.48f, 14.9f, 0f, 15.62f, 0f, 16.43f)
                            verticalLineTo(18f)
                            lineToRelative(4.5f, 0f)
                            verticalLineToRelative(-1.61f)
                            curveTo(4.5f, 15.56f, 4.73f, 14.78f, 5.13f, 14.1f)
                            close()
                            moveTo(20f, 13f)
                            curveToRelative(1.1f, 0f, 2f, -0.9f, 2f, -2f)
                            curveToRelative(0f, -1.1f, -0.9f, -2f, -2f, -2f)
                            reflectiveCurveToRelative(-2f, 0.9f, -2f, 2f)
                            curveTo(18f, 12.1f, 18.9f, 13f, 20f, 13f)
                            close()
                            moveTo(24f, 16.43f)
                            curveToRelative(0f, -0.81f, -0.48f, -1.53f, -1.22f, -1.85f)
                            curveTo(21.93f, 14.21f, 20.99f, 14f, 20f, 14f)
                            curveToRelative(-0.39f, 0f, -0.76f, 0.04f, -1.13f, 0.1f)
                            curveToRelative(0.4f, 0.68f, 0.63f, 1.46f, 0.63f, 2.29f)
                            verticalLineTo(18f)
                            lineToRelative(4.5f, 0f)
                            verticalLineTo(16.43f)
                            close()
                            moveTo(16.24f, 13.65f)
                            curveToRelative(-1.17f, -0.52f, -2.61f, -0.9f, -4.24f, -0.9f)
                            curveToRelative(-1.63f, 0f, -3.07f, 0.39f, -4.24f, 0.9f)
                            curveTo(6.68f, 14.13f, 6f, 15.21f, 6f, 16.39f)
                            verticalLineTo(18f)
                            horizontalLineToRelative(12f)
                            verticalLineToRelative(-1.61f)
                            curveTo(18f, 15.21f, 17.32f, 14.13f, 16.24f, 13.65f)
                            close()
                            moveTo(8.07f, 16f)
                            curveToRelative(0.09f, -0.23f, 0.13f, -0.39f, 0.91f, -0.69f)
                            curveToRelative(0.97f, -0.38f, 1.99f, -0.56f, 3.02f, -0.56f)
                            reflectiveCurveToRelative(2.05f, 0.18f, 3.02f, 0.56f)
                            curveToRelative(0.77f, 0.3f, 0.81f, 0.46f, 0.91f, 0.69f)
                            horizontalLineTo(8.07f)
                            close()
                            moveTo(12f, 8f)
                            curveToRelative(0.55f, 0f, 1f, 0.45f, 1f, 1f)
                            reflectiveCurveToRelative(-0.45f, 1f, -1f, 1f)
                            reflectiveCurveToRelative(-1f, -0.45f, -1f, -1f)
                            reflectiveCurveTo(11.45f, 8f, 12f, 8f)
                            moveTo(12f, 6f)
                            curveToRelative(-1.66f, 0f, -3f, 1.34f, -3f, 3f)
                            curveToRelative(0f, 1.66f, 1.34f, 3f, 3f, 3f)
                            reflectiveCurveToRelative(3f, -1.34f, 3f, -3f)
                            curveTo(15f, 7.34f, 13.66f, 6f, 12f, 6f)
                            lineTo(12f, 6f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Info` */
        val Info: ImageVector =
            materialIcon(
                name = "Outlined.Info",
                drawPaths =
                    listOf(
                        {
                            moveTo(11f, 7f)
                            horizontalLineToRelative(2f)
                            verticalLineToRelative(2f)
                            horizontalLineToRelative(-2f)
                            close()
                            moveTo(11f, 11f)
                            horizontalLineToRelative(2f)
                            verticalLineToRelative(6f)
                            horizontalLineToRelative(-2f)
                            close()
                            moveTo(12f, 2f)
                            curveTo(6.48f, 2f, 2f, 6.48f, 2f, 12f)
                            reflectiveCurveToRelative(4.48f, 10f, 10f, 10f)
                            reflectiveCurveToRelative(10f, -4.48f, 10f, -10f)
                            reflectiveCurveTo(17.52f, 2f, 12f, 2f)
                            close()
                            moveTo(12f, 20f)
                            curveToRelative(-4.41f, 0f, -8f, -3.59f, -8f, -8f)
                            reflectiveCurveToRelative(3.59f, -8f, 8f, -8f)
                            reflectiveCurveToRelative(8f, 3.59f, 8f, 8f)
                            reflectiveCurveToRelative(-3.59f, 8f, -8f, 8f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Notifications` */
        val Notifications: ImageVector =
            materialIcon(
                name = "Outlined.Notifications",
                drawPaths =
                    listOf(
                        {
                            moveTo(12f, 22f)
                            curveToRelative(1.1f, 0f, 2f, -0.9f, 2f, -2f)
                            horizontalLineToRelative(-4f)
                            curveToRelative(0f, 1.1f, 0.9f, 2f, 2f, 2f)
                            close()
                            moveTo(18f, 16f)
                            verticalLineToRelative(-5f)
                            curveToRelative(0f, -3.07f, -1.63f, -5.64f, -4.5f, -6.32f)
                            lineTo(13.5f, 4f)
                            curveToRelative(0f, -0.83f, -0.67f, -1.5f, -1.5f, -1.5f)
                            reflectiveCurveToRelative(-1.5f, 0.67f, -1.5f, 1.5f)
                            verticalLineToRelative(0.68f)
                            curveTo(7.64f, 5.36f, 6f, 7.92f, 6f, 11f)
                            verticalLineToRelative(5f)
                            lineToRelative(-2f, 2f)
                            verticalLineToRelative(1f)
                            horizontalLineToRelative(16f)
                            verticalLineToRelative(-1f)
                            lineToRelative(-2f, -2f)
                            close()
                            moveTo(16f, 17f)
                            lineTo(8f, 17f)
                            verticalLineToRelative(-6f)
                            curveToRelative(0f, -2.48f, 1.51f, -4.5f, 4f, -4.5f)
                            reflectiveCurveToRelative(4f, 2.02f, 4f, 4.5f)
                            verticalLineToRelative(6f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Palette` */
        val Palette: ImageVector =
            materialIcon(
                name = "Outlined.Palette",
                drawPaths =
                    listOf(
                        {
                            moveTo(12f, 22f)
                            curveTo(6.49f, 22f, 2f, 17.51f, 2f, 12f)
                            reflectiveCurveTo(6.49f, 2f, 12f, 2f)
                            reflectiveCurveToRelative(10f, 4.04f, 10f, 9f)
                            curveToRelative(0f, 3.31f, -2.69f, 6f, -6f, 6f)
                            horizontalLineToRelative(-1.77f)
                            curveToRelative(-0.28f, 0f, -0.5f, 0.22f, -0.5f, 0.5f)
                            curveToRelative(0f, 0.12f, 0.05f, 0.23f, 0.13f, 0.33f)
                            curveToRelative(0.41f, 0.47f, 0.64f, 1.06f, 0.64f, 1.67f)
                            curveTo(14.5f, 20.88f, 13.38f, 22f, 12f, 22f)
                            close()
                            moveTo(12f, 4f)
                            curveToRelative(-4.41f, 0f, -8f, 3.59f, -8f, 8f)
                            reflectiveCurveToRelative(3.59f, 8f, 8f, 8f)
                            curveToRelative(0.28f, 0f, 0.5f, -0.22f, 0.5f, -0.5f)
                            curveToRelative(0f, -0.16f, -0.08f, -0.28f, -0.14f, -0.35f)
                            curveToRelative(-0.41f, -0.46f, -0.63f, -1.05f, -0.63f, -1.65f)
                            curveToRelative(0f, -1.38f, 1.12f, -2.5f, 2.5f, -2.5f)
                            horizontalLineTo(16f)
                            curveToRelative(2.21f, 0f, 4f, -1.79f, 4f, -4f)
                            curveTo(20f, 7.14f, 16.41f, 4f, 12f, 4f)
                            close()
                        },
                        {
                            moveTo(6.5f, 11.5f)
                            moveToRelative(-1.5f, 0f)
                            arcToRelative(1.5f, 1.5f, 0f, true, true, 3f, 0f)
                            arcToRelative(1.5f, 1.5f, 0f, true, true, -3f, 0f)
                        },
                        {
                            moveTo(9.5f, 7.5f)
                            moveToRelative(-1.5f, 0f)
                            arcToRelative(1.5f, 1.5f, 0f, true, true, 3f, 0f)
                            arcToRelative(1.5f, 1.5f, 0f, true, true, -3f, 0f)
                        },
                        {
                            moveTo(14.5f, 7.5f)
                            moveToRelative(-1.5f, 0f)
                            arcToRelative(1.5f, 1.5f, 0f, true, true, 3f, 0f)
                            arcToRelative(1.5f, 1.5f, 0f, true, true, -3f, 0f)
                        },
                        {
                            moveTo(17.5f, 11.5f)
                            moveToRelative(-1.5f, 0f)
                            arcToRelative(1.5f, 1.5f, 0f, true, true, 3f, 0f)
                            arcToRelative(1.5f, 1.5f, 0f, true, true, -3f, 0f)
                        },
                    ),
            )

        /** `Outlined.Pause` */
        val Pause: ImageVector =
            materialIcon(
                name = "Outlined.Pause",
                drawPaths =
                    listOf(
                        {
                            moveTo(6f, 19f)
                            horizontalLineToRelative(4f)
                            lineTo(10f, 5f)
                            lineTo(6f, 5f)
                            verticalLineToRelative(14f)
                            close()
                            moveTo(14f, 5f)
                            verticalLineToRelative(14f)
                            horizontalLineToRelative(4f)
                            lineTo(18f, 5f)
                            horizontalLineToRelative(-4f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Person` */
        val Person: ImageVector =
            materialIcon(
                name = "Outlined.Person",
                drawPaths =
                    listOf(
                        {
                            moveTo(12f, 6f)
                            curveToRelative(1.1f, 0f, 2f, 0.9f, 2f, 2f)
                            reflectiveCurveToRelative(-0.9f, 2f, -2f, 2f)
                            reflectiveCurveToRelative(-2f, -0.9f, -2f, -2f)
                            reflectiveCurveToRelative(0.9f, -2f, 2f, -2f)
                            moveToRelative(0f, 10f)
                            curveToRelative(2.7f, 0f, 5.8f, 1.29f, 6f, 2f)
                            lineTo(6f, 18f)
                            curveToRelative(0.23f, -0.72f, 3.31f, -2f, 6f, -2f)
                            moveToRelative(0f, -12f)
                            curveTo(9.79f, 4f, 8f, 5.79f, 8f, 8f)
                            reflectiveCurveToRelative(1.79f, 4f, 4f, 4f)
                            reflectiveCurveToRelative(4f, -1.79f, 4f, -4f)
                            reflectiveCurveToRelative(-1.79f, -4f, -4f, -4f)
                            close()
                            moveTo(12f, 14f)
                            curveToRelative(-2.67f, 0f, -8f, 1.34f, -8f, 4f)
                            verticalLineToRelative(2f)
                            horizontalLineToRelative(16f)
                            verticalLineToRelative(-2f)
                            curveToRelative(0f, -2.66f, -5.33f, -4f, -8f, -4f)
                            close()
                        },
                    ),
            )

        /** `Outlined.PlayArrow` */
        val PlayArrow: ImageVector =
            materialIcon(
                name = "Outlined.PlayArrow",
                drawPaths =
                    listOf(
                        {
                            moveTo(10f, 8.64f)
                            lineTo(15.27f, 12f)
                            lineTo(10f, 15.36f)
                            verticalLineTo(8.64f)
                            moveTo(8f, 5f)
                            verticalLineToRelative(14f)
                            lineToRelative(11f, -7f)
                            lineTo(8f, 5f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Quiz` */
        val Quiz: ImageVector =
            materialIcon(
                name = "Outlined.Quiz",
                drawPaths =
                    listOf(
                        {
                            moveTo(4f, 6f)
                            horizontalLineTo(2f)
                            verticalLineToRelative(14f)
                            curveToRelative(0f, 1.1f, 0.9f, 2f, 2f, 2f)
                            horizontalLineToRelative(14f)
                            verticalLineToRelative(-2f)
                            horizontalLineTo(4f)
                            verticalLineTo(6f)
                            close()
                            moveTo(20f, 2f)
                            horizontalLineTo(8f)
                            curveTo(6.9f, 2f, 6f, 2.9f, 6f, 4f)
                            verticalLineToRelative(12f)
                            curveToRelative(0f, 1.1f, 0.9f, 2f, 2f, 2f)
                            horizontalLineToRelative(12f)
                            curveToRelative(1.1f, 0f, 2f, -0.9f, 2f, -2f)
                            verticalLineTo(4f)
                            curveTo(22f, 2.9f, 21.1f, 2f, 20f, 2f)
                            close()
                            moveTo(20f, 16f)
                            horizontalLineTo(8f)
                            verticalLineTo(4f)
                            horizontalLineToRelative(12f)
                            verticalLineTo(16f)
                            close()
                            moveTo(13.51f, 10.16f)
                            curveToRelative(0.41f, -0.73f, 1.18f, -1.16f, 1.63f, -1.8f)
                            curveToRelative(0.48f, -0.68f, 0.21f, -1.94f, -1.14f, -1.94f)
                            curveToRelative(-0.88f, 0f, -1.32f, 0.67f, -1.5f, 1.23f)
                            lineToRelative(-1.37f, -0.57f)
                            curveTo(11.51f, 5.96f, 12.52f, 5f, 13.99f, 5f)
                            curveToRelative(1.23f, 0f, 2.08f, 0.56f, 2.51f, 1.26f)
                            curveToRelative(0.37f, 0.6f, 0.58f, 1.73f, 0.01f, 2.57f)
                            curveToRelative(-0.63f, 0.93f, -1.23f, 1.21f, -1.56f, 1.81f)
                            curveToRelative(-0.13f, 0.24f, -0.18f, 0.4f, -0.18f, 1.18f)
                            horizontalLineToRelative(-1.52f)
                            curveTo(13.26f, 11.41f, 13.19f, 10.74f, 13.51f, 10.16f)
                            close()
                            moveTo(12.95f, 13.95f)
                            curveToRelative(0f, -0.59f, 0.47f, -1.04f, 1.05f, -1.04f)
                            curveToRelative(0.59f, 0f, 1.04f, 0.45f, 1.04f, 1.04f)
                            curveToRelative(0f, 0.58f, -0.44f, 1.05f, -1.04f, 1.05f)
                            curveTo(13.42f, 15f, 12.95f, 14.53f, 12.95f, 13.95f)
                            close()
                        },
                    ),
            )

        /** `Outlined.RadioButtonUnchecked` */
        val RadioButtonUnchecked: ImageVector =
            materialIcon(
                name = "Outlined.RadioButtonUnchecked",
                drawPaths =
                    listOf(
                        {
                            moveTo(12f, 2f)
                            curveTo(6.48f, 2f, 2f, 6.48f, 2f, 12f)
                            reflectiveCurveToRelative(4.48f, 10f, 10f, 10f)
                            reflectiveCurveToRelative(10f, -4.48f, 10f, -10f)
                            reflectiveCurveTo(17.52f, 2f, 12f, 2f)
                            close()
                            moveTo(12f, 20f)
                            curveToRelative(-4.42f, 0f, -8f, -3.58f, -8f, -8f)
                            reflectiveCurveToRelative(3.58f, -8f, 8f, -8f)
                            reflectiveCurveToRelative(8f, 3.58f, 8f, 8f)
                            reflectiveCurveToRelative(-3.58f, 8f, -8f, 8f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Refresh` */
        val Refresh: ImageVector =
            materialIcon(
                name = "Outlined.Refresh",
                drawPaths =
                    listOf(
                        {
                            moveTo(17.65f, 6.35f)
                            curveTo(16.2f, 4.9f, 14.21f, 4f, 12f, 4f)
                            curveToRelative(-4.42f, 0f, -7.99f, 3.58f, -7.99f, 8f)
                            reflectiveCurveToRelative(3.57f, 8f, 7.99f, 8f)
                            curveToRelative(3.73f, 0f, 6.84f, -2.55f, 7.73f, -6f)
                            horizontalLineToRelative(-2.08f)
                            curveToRelative(-0.82f, 2.33f, -3.04f, 4f, -5.65f, 4f)
                            curveToRelative(-3.31f, 0f, -6f, -2.69f, -6f, -6f)
                            reflectiveCurveToRelative(2.69f, -6f, 6f, -6f)
                            curveToRelative(1.66f, 0f, 3.14f, 0.69f, 4.22f, 1.78f)
                            lineTo(13f, 11f)
                            horizontalLineToRelative(7f)
                            verticalLineTo(4f)
                            lineToRelative(-2.35f, 2.35f)
                            close()
                        },
                    ),
            )

        /** `Outlined.RssFeed` */
        val RssFeed: ImageVector =
            materialIcon(
                name = "Outlined.RssFeed",
                drawPaths =
                    listOf(
                        {
                            moveTo(6.18f, 17.82f)
                            moveToRelative(-2.18f, 0f)
                            arcToRelative(2.18f, 2.18f, 0f, true, true, 4.36f, 0f)
                            arcToRelative(2.18f, 2.18f, 0f, true, true, -4.36f, 0f)
                        },
                        {
                            moveTo(4f, 4.44f)
                            verticalLineToRelative(2.83f)
                            curveToRelative(7.03f, 0f, 12.73f, 5.7f, 12.73f, 12.73f)
                            horizontalLineToRelative(2.83f)
                            curveToRelative(0f, -8.59f, -6.97f, -15.56f, -15.56f, -15.56f)
                            close()
                            moveTo(4f, 10.1f)
                            verticalLineToRelative(2.83f)
                            curveToRelative(3.9f, 0f, 7.07f, 3.17f, 7.07f, 7.07f)
                            horizontalLineToRelative(2.83f)
                            curveToRelative(0f, -5.47f, -4.43f, -9.9f, -9.9f, -9.9f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Save` */
        val Save: ImageVector =
            materialIcon(
                name = "Outlined.Save",
                drawPaths =
                    listOf(
                        {
                            moveTo(17f, 3f)
                            lineTo(5f, 3f)
                            curveToRelative(-1.11f, 0f, -2f, 0.9f, -2f, 2f)
                            verticalLineToRelative(14f)
                            curveToRelative(0f, 1.1f, 0.89f, 2f, 2f, 2f)
                            horizontalLineToRelative(14f)
                            curveToRelative(1.1f, 0f, 2f, -0.9f, 2f, -2f)
                            lineTo(21f, 7f)
                            lineToRelative(-4f, -4f)
                            close()
                            moveTo(19f, 19f)
                            lineTo(5f, 19f)
                            lineTo(5f, 5f)
                            horizontalLineToRelative(11.17f)
                            lineTo(19f, 7.83f)
                            lineTo(19f, 19f)
                            close()
                            moveTo(12f, 12f)
                            curveToRelative(-1.66f, 0f, -3f, 1.34f, -3f, 3f)
                            reflectiveCurveToRelative(1.34f, 3f, 3f, 3f)
                            reflectiveCurveToRelative(3f, -1.34f, 3f, -3f)
                            reflectiveCurveToRelative(-1.34f, -3f, -3f, -3f)
                            close()
                            moveTo(6f, 6f)
                            horizontalLineToRelative(9f)
                            verticalLineToRelative(4f)
                            lineTo(6f, 10f)
                            close()
                        },
                    ),
            )

        /** `Outlined.School` */
        val School: ImageVector =
            materialIcon(
                name = "Outlined.School",
                drawPaths =
                    listOf(
                        {
                            moveTo(12f, 3f)
                            lineTo(1f, 9f)
                            lineToRelative(4f, 2.18f)
                            verticalLineToRelative(6f)
                            lineTo(12f, 21f)
                            lineToRelative(7f, -3.82f)
                            verticalLineToRelative(-6f)
                            lineToRelative(2f, -1.09f)
                            lineTo(21f, 17f)
                            horizontalLineToRelative(2f)
                            lineTo(23f, 9f)
                            lineTo(12f, 3f)
                            close()
                            moveTo(18.82f, 9f)
                            lineTo(12f, 12.72f)
                            lineTo(5.18f, 9f)
                            lineTo(12f, 5.28f)
                            lineTo(18.82f, 9f)
                            close()
                            moveTo(17f, 15.99f)
                            lineToRelative(-5f, 2.73f)
                            lineToRelative(-5f, -2.73f)
                            verticalLineToRelative(-3.72f)
                            lineTo(12f, 15f)
                            lineToRelative(5f, -2.73f)
                            verticalLineToRelative(3.72f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Search` */
        val Search: ImageVector =
            materialIcon(
                name = "Outlined.Search",
                drawPaths =
                    listOf(
                        {
                            moveTo(15.5f, 14f)
                            horizontalLineToRelative(-0.79f)
                            lineToRelative(-0.28f, -0.27f)
                            curveTo(15.41f, 12.59f, 16f, 11.11f, 16f, 9.5f)
                            curveTo(16f, 5.91f, 13.09f, 3f, 9.5f, 3f)
                            reflectiveCurveTo(3f, 5.91f, 3f, 9.5f)
                            reflectiveCurveTo(5.91f, 16f, 9.5f, 16f)
                            curveToRelative(1.61f, 0f, 3.09f, -0.59f, 4.23f, -1.57f)
                            lineToRelative(0.27f, 0.28f)
                            verticalLineToRelative(0.79f)
                            lineToRelative(5f, 4.99f)
                            lineTo(20.49f, 19f)
                            lineToRelative(-4.99f, -5f)
                            close()
                            moveTo(9.5f, 14f)
                            curveTo(7.01f, 14f, 5f, 11.99f, 5f, 9.5f)
                            reflectiveCurveTo(7.01f, 5f, 9.5f, 5f)
                            reflectiveCurveTo(14f, 7.01f, 14f, 9.5f)
                            reflectiveCurveTo(11.99f, 14f, 9.5f, 14f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Settings` */
        val Settings: ImageVector =
            materialIcon(
                name = "Outlined.Settings",
                drawPaths =
                    listOf(
                        {
                            moveTo(19.43f, 12.98f)
                            curveToRelative(0.04f, -0.32f, 0.07f, -0.64f, 0.07f, -0.98f)
                            curveToRelative(0f, -0.34f, -0.03f, -0.66f, -0.07f, -0.98f)
                            lineToRelative(2.11f, -1.65f)
                            curveToRelative(0.19f, -0.15f, 0.24f, -0.42f, 0.12f, -0.64f)
                            lineToRelative(-2f, -3.46f)
                            curveToRelative(-0.09f, -0.16f, -0.26f, -0.25f, -0.44f, -0.25f)
                            curveToRelative(-0.06f, 0f, -0.12f, 0.01f, -0.17f, 0.03f)
                            lineToRelative(-2.49f, 1f)
                            curveToRelative(-0.52f, -0.4f, -1.08f, -0.73f, -1.69f, -0.98f)
                            lineToRelative(-0.38f, -2.65f)
                            curveTo(14.46f, 2.18f, 14.25f, 2f, 14f, 2f)
                            horizontalLineToRelative(-4f)
                            curveToRelative(-0.25f, 0f, -0.46f, 0.18f, -0.49f, 0.42f)
                            lineToRelative(-0.38f, 2.65f)
                            curveToRelative(-0.61f, 0.25f, -1.17f, 0.59f, -1.69f, 0.98f)
                            lineToRelative(-2.49f, -1f)
                            curveToRelative(-0.06f, -0.02f, -0.12f, -0.03f, -0.18f, -0.03f)
                            curveToRelative(-0.17f, 0f, -0.34f, 0.09f, -0.43f, 0.25f)
                            lineToRelative(-2f, 3.46f)
                            curveToRelative(-0.13f, 0.22f, -0.07f, 0.49f, 0.12f, 0.64f)
                            lineToRelative(2.11f, 1.65f)
                            curveToRelative(-0.04f, 0.32f, -0.07f, 0.65f, -0.07f, 0.98f)
                            curveToRelative(0f, 0.33f, 0.03f, 0.66f, 0.07f, 0.98f)
                            lineToRelative(-2.11f, 1.65f)
                            curveToRelative(-0.19f, 0.15f, -0.24f, 0.42f, -0.12f, 0.64f)
                            lineToRelative(2f, 3.46f)
                            curveToRelative(0.09f, 0.16f, 0.26f, 0.25f, 0.44f, 0.25f)
                            curveToRelative(0.06f, 0f, 0.12f, -0.01f, 0.17f, -0.03f)
                            lineToRelative(2.49f, -1f)
                            curveToRelative(0.52f, 0.4f, 1.08f, 0.73f, 1.69f, 0.98f)
                            lineToRelative(0.38f, 2.65f)
                            curveToRelative(0.03f, 0.24f, 0.24f, 0.42f, 0.49f, 0.42f)
                            horizontalLineToRelative(4f)
                            curveToRelative(0.25f, 0f, 0.46f, -0.18f, 0.49f, -0.42f)
                            lineToRelative(0.38f, -2.65f)
                            curveToRelative(0.61f, -0.25f, 1.17f, -0.59f, 1.69f, -0.98f)
                            lineToRelative(2.49f, 1f)
                            curveToRelative(0.06f, 0.02f, 0.12f, 0.03f, 0.18f, 0.03f)
                            curveToRelative(0.17f, 0f, 0.34f, -0.09f, 0.43f, -0.25f)
                            lineToRelative(2f, -3.46f)
                            curveToRelative(0.12f, -0.22f, 0.07f, -0.49f, -0.12f, -0.64f)
                            lineToRelative(-2.11f, -1.65f)
                            close()
                            moveTo(17.45f, 11.27f)
                            curveToRelative(0.04f, 0.31f, 0.05f, 0.52f, 0.05f, 0.73f)
                            curveToRelative(0f, 0.21f, -0.02f, 0.43f, -0.05f, 0.73f)
                            lineToRelative(-0.14f, 1.13f)
                            lineToRelative(0.89f, 0.7f)
                            lineToRelative(1.08f, 0.84f)
                            lineToRelative(-0.7f, 1.21f)
                            lineToRelative(-1.27f, -0.51f)
                            lineToRelative(-1.04f, -0.42f)
                            lineToRelative(-0.9f, 0.68f)
                            curveToRelative(-0.43f, 0.32f, -0.84f, 0.56f, -1.25f, 0.73f)
                            lineToRelative(-1.06f, 0.43f)
                            lineToRelative(-0.16f, 1.13f)
                            lineToRelative(-0.2f, 1.35f)
                            horizontalLineToRelative(-1.4f)
                            lineToRelative(-0.19f, -1.35f)
                            lineToRelative(-0.16f, -1.13f)
                            lineToRelative(-1.06f, -0.43f)
                            curveToRelative(-0.43f, -0.18f, -0.83f, -0.41f, -1.23f, -0.71f)
                            lineToRelative(-0.91f, -0.7f)
                            lineToRelative(-1.06f, 0.43f)
                            lineToRelative(-1.27f, 0.51f)
                            lineToRelative(-0.7f, -1.21f)
                            lineToRelative(1.08f, -0.84f)
                            lineToRelative(0.89f, -0.7f)
                            lineToRelative(-0.14f, -1.13f)
                            curveToRelative(-0.03f, -0.31f, -0.05f, -0.54f, -0.05f, -0.74f)
                            reflectiveCurveToRelative(0.02f, -0.43f, 0.05f, -0.73f)
                            lineToRelative(0.14f, -1.13f)
                            lineToRelative(-0.89f, -0.7f)
                            lineToRelative(-1.08f, -0.84f)
                            lineToRelative(0.7f, -1.21f)
                            lineToRelative(1.27f, 0.51f)
                            lineToRelative(1.04f, 0.42f)
                            lineToRelative(0.9f, -0.68f)
                            curveToRelative(0.43f, -0.32f, 0.84f, -0.56f, 1.25f, -0.73f)
                            lineToRelative(1.06f, -0.43f)
                            lineToRelative(0.16f, -1.13f)
                            lineToRelative(0.2f, -1.35f)
                            horizontalLineToRelative(1.39f)
                            lineToRelative(0.19f, 1.35f)
                            lineToRelative(0.16f, 1.13f)
                            lineToRelative(1.06f, 0.43f)
                            curveToRelative(0.43f, 0.18f, 0.83f, 0.41f, 1.23f, 0.71f)
                            lineToRelative(0.91f, 0.7f)
                            lineToRelative(1.06f, -0.43f)
                            lineToRelative(1.27f, -0.51f)
                            lineToRelative(0.7f, 1.21f)
                            lineToRelative(-1.07f, 0.85f)
                            lineToRelative(-0.89f, 0.7f)
                            lineToRelative(0.14f, 1.13f)
                            close()
                            moveTo(12f, 8f)
                            curveToRelative(-2.21f, 0f, -4f, 1.79f, -4f, 4f)
                            reflectiveCurveToRelative(1.79f, 4f, 4f, 4f)
                            reflectiveCurveToRelative(4f, -1.79f, 4f, -4f)
                            reflectiveCurveToRelative(-1.79f, -4f, -4f, -4f)
                            close()
                            moveTo(12f, 14f)
                            curveToRelative(-1.1f, 0f, -2f, -0.9f, -2f, -2f)
                            reflectiveCurveToRelative(0.9f, -2f, 2f, -2f)
                            reflectiveCurveToRelative(2f, 0.9f, 2f, 2f)
                            reflectiveCurveToRelative(-0.9f, 2f, -2f, 2f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Share` */
        val Share: ImageVector =
            materialIcon(
                name = "Outlined.Share",
                drawPaths =
                    listOf(
                        {
                            moveTo(18f, 16.08f)
                            curveToRelative(-0.76f, 0f, -1.44f, 0.3f, -1.96f, 0.77f)
                            lineTo(8.91f, 12.7f)
                            curveToRelative(0.05f, -0.23f, 0.09f, -0.46f, 0.09f, -0.7f)
                            reflectiveCurveToRelative(-0.04f, -0.47f, -0.09f, -0.7f)
                            lineToRelative(7.05f, -4.11f)
                            curveToRelative(0.54f, 0.5f, 1.25f, 0.81f, 2.04f, 0.81f)
                            curveToRelative(1.66f, 0f, 3f, -1.34f, 3f, -3f)
                            reflectiveCurveToRelative(-1.34f, -3f, -3f, -3f)
                            reflectiveCurveToRelative(-3f, 1.34f, -3f, 3f)
                            curveToRelative(0f, 0.24f, 0.04f, 0.47f, 0.09f, 0.7f)
                            lineTo(8.04f, 9.81f)
                            curveTo(7.5f, 9.31f, 6.79f, 9f, 6f, 9f)
                            curveToRelative(-1.66f, 0f, -3f, 1.34f, -3f, 3f)
                            reflectiveCurveToRelative(1.34f, 3f, 3f, 3f)
                            curveToRelative(0.79f, 0f, 1.5f, -0.31f, 2.04f, -0.81f)
                            lineToRelative(7.12f, 4.16f)
                            curveToRelative(-0.05f, 0.21f, -0.08f, 0.43f, -0.08f, 0.65f)
                            curveToRelative(0f, 1.61f, 1.31f, 2.92f, 2.92f, 2.92f)
                            reflectiveCurveToRelative(2.92f, -1.31f, 2.92f, -2.92f)
                            curveToRelative(0f, -1.61f, -1.31f, -2.92f, -2.92f, -2.92f)
                            close()
                            moveTo(18f, 4f)
                            curveToRelative(0.55f, 0f, 1f, 0.45f, 1f, 1f)
                            reflectiveCurveToRelative(-0.45f, 1f, -1f, 1f)
                            reflectiveCurveToRelative(-1f, -0.45f, -1f, -1f)
                            reflectiveCurveToRelative(0.45f, -1f, 1f, -1f)
                            close()
                            moveTo(6f, 13f)
                            curveToRelative(-0.55f, 0f, -1f, -0.45f, -1f, -1f)
                            reflectiveCurveToRelative(0.45f, -1f, 1f, -1f)
                            reflectiveCurveToRelative(1f, 0.45f, 1f, 1f)
                            reflectiveCurveToRelative(-0.45f, 1f, -1f, 1f)
                            close()
                            moveTo(18f, 20.02f)
                            curveToRelative(-0.55f, 0f, -1f, -0.45f, -1f, -1f)
                            reflectiveCurveToRelative(0.45f, -1f, 1f, -1f)
                            reflectiveCurveToRelative(1f, 0.45f, 1f, 1f)
                            reflectiveCurveToRelative(-0.45f, 1f, -1f, 1f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Shield` */
        val Shield: ImageVector =
            materialIcon(
                name = "Outlined.Shield",
                drawPaths =
                    listOf(
                        {
                            moveTo(12f, 2f)
                            lineTo(4f, 5f)
                            verticalLineToRelative(6.09f)
                            curveToRelative(0f, 5.05f, 3.41f, 9.76f, 8f, 10.91f)
                            curveToRelative(4.59f, -1.15f, 8f, -5.86f, 8f, -10.91f)
                            verticalLineTo(5f)
                            lineTo(12f, 2f)
                            close()
                            moveTo(18f, 11.09f)
                            curveToRelative(0f, 4f, -2.55f, 7.7f, -6f, 8.83f)
                            curveToRelative(-3.45f, -1.13f, -6f, -4.82f, -6f, -8.83f)
                            verticalLineToRelative(-4.7f)
                            lineToRelative(6f, -2.25f)
                            lineToRelative(6f, 2.25f)
                            verticalLineTo(11.09f)
                            close()
                        },
                    ),
            )

        /** `Outlined.SpaceDashboard` */
        val SpaceDashboard: ImageVector =
            materialIcon(
                name = "Outlined.SpaceDashboard",
                drawPaths =
                    listOf(
                        {
                            moveTo(19f, 3f)
                            horizontalLineTo(5f)
                            curveTo(3.9f, 3f, 3f, 3.9f, 3f, 5f)
                            verticalLineToRelative(14f)
                            curveToRelative(0f, 1.1f, 0.9f, 2f, 2f, 2f)
                            horizontalLineToRelative(14f)
                            curveToRelative(1.1f, 0f, 2f, -0.9f, 2f, -2f)
                            verticalLineTo(5f)
                            curveTo(21f, 3.9f, 20.1f, 3f, 19f, 3f)
                            close()
                            moveTo(5f, 19f)
                            verticalLineTo(5f)
                            horizontalLineToRelative(6f)
                            verticalLineToRelative(14f)
                            horizontalLineTo(5f)
                            close()
                            moveTo(19f, 19f)
                            horizontalLineToRelative(-6f)
                            verticalLineToRelative(-7f)
                            horizontalLineToRelative(6f)
                            verticalLineTo(19f)
                            close()
                            moveTo(19f, 10f)
                            horizontalLineToRelative(-6f)
                            verticalLineTo(5f)
                            horizontalLineToRelative(6f)
                            verticalLineTo(10f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Storage` */
        val Storage: ImageVector =
            materialIcon(
                name = "Outlined.Storage",
                drawPaths =
                    listOf(
                        {
                            moveTo(2f, 20f)
                            horizontalLineToRelative(20f)
                            verticalLineToRelative(-4f)
                            lineTo(2f, 16f)
                            verticalLineToRelative(4f)
                            close()
                            moveTo(4f, 17f)
                            horizontalLineToRelative(2f)
                            verticalLineToRelative(2f)
                            lineTo(4f, 19f)
                            verticalLineToRelative(-2f)
                            close()
                            moveTo(2f, 4f)
                            verticalLineToRelative(4f)
                            horizontalLineToRelative(20f)
                            lineTo(22f, 4f)
                            lineTo(2f, 4f)
                            close()
                            moveTo(6f, 7f)
                            lineTo(4f, 7f)
                            lineTo(4f, 5f)
                            horizontalLineToRelative(2f)
                            verticalLineToRelative(2f)
                            close()
                            moveTo(2f, 14f)
                            horizontalLineToRelative(20f)
                            verticalLineToRelative(-4f)
                            lineTo(2f, 10f)
                            verticalLineToRelative(4f)
                            close()
                            moveTo(4f, 11f)
                            horizontalLineToRelative(2f)
                            verticalLineToRelative(2f)
                            lineTo(4f, 13f)
                            verticalLineToRelative(-2f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Sync` */
        val Sync: ImageVector =
            materialIcon(
                name = "Outlined.Sync",
                drawPaths =
                    listOf(
                        {
                            moveTo(12f, 4f)
                            lineTo(12f, 1f)
                            lineTo(8f, 5f)
                            lineToRelative(4f, 4f)
                            lineTo(12f, 6f)
                            curveToRelative(3.31f, 0f, 6f, 2.69f, 6f, 6f)
                            curveToRelative(0f, 1.01f, -0.25f, 1.97f, -0.7f, 2.8f)
                            lineToRelative(1.46f, 1.46f)
                            curveTo(19.54f, 15.03f, 20f, 13.57f, 20f, 12f)
                            curveToRelative(0f, -4.42f, -3.58f, -8f, -8f, -8f)
                            close()
                            moveTo(12f, 18f)
                            curveToRelative(-3.31f, 0f, -6f, -2.69f, -6f, -6f)
                            curveToRelative(0f, -1.01f, 0.25f, -1.97f, 0.7f, -2.8f)
                            lineTo(5.24f, 7.74f)
                            curveTo(4.46f, 8.97f, 4f, 10.43f, 4f, 12f)
                            curveToRelative(0f, 4.42f, 3.58f, 8f, 8f, 8f)
                            verticalLineToRelative(3f)
                            lineToRelative(4f, -4f)
                            lineToRelative(-4f, -4f)
                            verticalLineToRelative(3f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Timer` */
        val Timer: ImageVector =
            materialIcon(
                name = "Outlined.Timer",
                drawPaths =
                    listOf(
                        {
                            moveTo(15f, 1f)
                            horizontalLineTo(9f)
                            verticalLineToRelative(2f)
                            horizontalLineToRelative(6f)
                            verticalLineTo(1f)
                            close()
                            moveTo(11f, 14f)
                            horizontalLineToRelative(2f)
                            verticalLineTo(8f)
                            horizontalLineToRelative(-2f)
                            verticalLineTo(14f)
                            close()
                            moveTo(19.03f, 7.39f)
                            lineToRelative(1.42f, -1.42f)
                            curveToRelative(-0.43f, -0.51f, -0.9f, -0.99f, -1.41f, -1.41f)
                            lineToRelative(-1.42f, 1.42f)
                            curveTo(16.07f, 4.74f, 14.12f, 4f, 12f, 4f)
                            curveToRelative(-4.97f, 0f, -9f, 4.03f, -9f, 9f)
                            reflectiveCurveToRelative(4.02f, 9f, 9f, 9f)
                            reflectiveCurveToRelative(9f, -4.03f, 9f, -9f)
                            curveTo(21f, 10.88f, 20.26f, 8.93f, 19.03f, 7.39f)
                            close()
                            moveTo(12f, 20f)
                            curveToRelative(-3.87f, 0f, -7f, -3.13f, -7f, -7f)
                            reflectiveCurveToRelative(3.13f, -7f, 7f, -7f)
                            reflectiveCurveToRelative(7f, 3.13f, 7f, 7f)
                            reflectiveCurveTo(15.87f, 20f, 12f, 20f)
                            close()
                        },
                    ),
            )

        /** `Outlined.UploadFile` */
        val UploadFile: ImageVector =
            materialIcon(
                name = "Outlined.UploadFile",
                drawPaths =
                    listOf(
                        {
                            moveTo(14f, 2f)
                            horizontalLineTo(6f)
                            curveTo(4.9f, 2f, 4.01f, 2.9f, 4.01f, 4f)
                            lineTo(4f, 20f)
                            curveToRelative(0f, 1.1f, 0.89f, 2f, 1.99f, 2f)
                            horizontalLineTo(18f)
                            curveToRelative(1.1f, 0f, 2f, -0.9f, 2f, -2f)
                            verticalLineTo(8f)
                            lineTo(14f, 2f)
                            close()
                            moveTo(18f, 20f)
                            horizontalLineTo(6f)
                            verticalLineTo(4f)
                            horizontalLineToRelative(7f)
                            verticalLineToRelative(5f)
                            horizontalLineToRelative(5f)
                            verticalLineTo(20f)
                            close()
                            moveTo(8f, 15.01f)
                            lineToRelative(1.41f, 1.41f)
                            lineTo(11f, 14.84f)
                            verticalLineTo(19f)
                            horizontalLineToRelative(2f)
                            verticalLineToRelative(-4.16f)
                            lineToRelative(1.59f, 1.59f)
                            lineTo(16f, 15.01f)
                            lineTo(12.01f, 11f)
                            lineTo(8f, 15.01f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Warning` */
        val Warning: ImageVector =
            materialIcon(
                name = "Outlined.Warning",
                drawPaths =
                    listOf(
                        {
                            moveTo(1f, 21f)
                            horizontalLineToRelative(22f)
                            lineTo(12f, 2f)
                            lineTo(1f, 21f)
                            close()
                            moveTo(13f, 18f)
                            horizontalLineToRelative(-2f)
                            verticalLineToRelative(-2f)
                            horizontalLineToRelative(2f)
                            verticalLineToRelative(2f)
                            close()
                            moveTo(13f, 14f)
                            horizontalLineToRelative(-2f)
                            verticalLineToRelative(-4f)
                            horizontalLineToRelative(2f)
                            verticalLineToRelative(4f)
                            close()
                        },
                    ),
            )

        /** `Outlined.Widgets` */
        val Widgets: ImageVector =
            materialIcon(
                name = "Outlined.Widgets",
                drawPaths =
                    listOf(
                        {
                            moveTo(16.66f, 4.52f)
                            lineToRelative(2.83f, 2.83f)
                            lineToRelative(-2.83f, 2.83f)
                            lineToRelative(-2.83f, -2.83f)
                            lineToRelative(2.83f, -2.83f)
                            moveTo(9f, 5f)
                            verticalLineToRelative(4f)
                            lineTo(5f, 9f)
                            lineTo(5f, 5f)
                            horizontalLineToRelative(4f)
                            moveToRelative(10f, 10f)
                            verticalLineToRelative(4f)
                            horizontalLineToRelative(-4f)
                            verticalLineToRelative(-4f)
                            horizontalLineToRelative(4f)
                            moveTo(9f, 15f)
                            verticalLineToRelative(4f)
                            lineTo(5f, 19f)
                            verticalLineToRelative(-4f)
                            horizontalLineToRelative(4f)
                            moveToRelative(7.66f, -13.31f)
                            lineTo(11f, 7.34f)
                            lineTo(16.66f, 13f)
                            lineToRelative(5.66f, -5.66f)
                            lineToRelative(-5.66f, -5.65f)
                            close()
                            moveTo(11f, 3f)
                            lineTo(3f, 3f)
                            verticalLineToRelative(8f)
                            horizontalLineToRelative(8f)
                            lineTo(11f, 3f)
                            close()
                            moveTo(21f, 13f)
                            horizontalLineToRelative(-8f)
                            verticalLineToRelative(8f)
                            horizontalLineToRelative(8f)
                            verticalLineToRelative(-8f)
                            close()
                            moveTo(11f, 13f)
                            lineTo(3f, 13f)
                            verticalLineToRelative(8f)
                            horizontalLineToRelative(8f)
                            verticalLineToRelative(-8f)
                            close()
                        },
                    ),
            )
    }

    object AutoMirrored {
        object Filled {
            /** `AutoMirrored.Filled.ArrowBack` */
            val ArrowBack: ImageVector =
                materialIcon(
                    name = "AutoMirrored.Filled.ArrowBack",
                    autoMirror = true,
                    drawPaths =
                        listOf(
                            {
                                moveTo(20f, 11f)
                                horizontalLineTo(7.83f)
                                lineToRelative(5.59f, -5.59f)
                                lineTo(12f, 4f)
                                lineToRelative(-8f, 8f)
                                lineToRelative(8f, 8f)
                                lineToRelative(1.41f, -1.41f)
                                lineTo(7.83f, 13f)
                                horizontalLineTo(20f)
                                verticalLineToRelative(-2f)
                                close()
                            },
                        ),
                )

            /** `AutoMirrored.Filled.ArrowForward` */
            val ArrowForward: ImageVector =
                materialIcon(
                    name = "AutoMirrored.Filled.ArrowForward",
                    autoMirror = true,
                    drawPaths =
                        listOf(
                            {
                                moveTo(12f, 4f)
                                lineToRelative(-1.41f, 1.41f)
                                lineTo(16.17f, 11f)
                                horizontalLineTo(4f)
                                verticalLineToRelative(2f)
                                horizontalLineToRelative(12.17f)
                                lineToRelative(-5.58f, 5.59f)
                                lineTo(12f, 20f)
                                lineToRelative(8f, -8f)
                                close()
                            },
                        ),
                )
        }
    }
}

/**
 * Builds an [ImageVector] that matches the Material icon of the same name.
 *
 * The arguments mirror the ones the Material icon generator emits, so the
 * resulting vector compares equal to the Material original. An icon with
 * several sub-paths gets one entry in [drawPaths] per sub-path.
 */
private fun materialIcon(
    name: String,
    autoMirror: Boolean = false,
    drawPaths: List<PathBuilder.() -> Unit>,
): ImageVector =
    ImageVector.Builder(
        name = name,
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f,
        autoMirror = autoMirror,
    ).apply {
        drawPaths.forEach { drawPath ->
            path(
                fill = SolidColor(Color.Black),
                fillAlpha = 1.0f,
                stroke = null,
                strokeAlpha = 1.0f,
                strokeLineWidth = 1.0f,
                strokeLineCap = StrokeCap.Butt,
                strokeLineJoin = StrokeJoin.Bevel,
                strokeLineMiter = 1.0f,
                pathFillType = PathFillType.NonZero,
            ) {
                drawPath.invoke(this)
            }
        }
    }.build()
